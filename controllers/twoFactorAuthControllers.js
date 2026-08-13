import mongoose from "mongoose";
import crypto from "crypto";
import qrcode from "qrcode";
import { generateSecret, generateURI, verify } from "otplib";
import { User } from "../models/user.model.js";
import { getErrorObject, getUserPayload, cookieOptions, setCsrfCookie } from "../utils/helper.js";
import { redisClient } from "../configs/redis.js";
import { authTokenSchema } from "../schemas/authSchema.js";
import { t } from "../misc/constants.js";

/**
 * path: GET /api/auth/2fa/generate
 * what it do: Generates a TOTP secret and returns a QR code base64 string for setup.
 */
export const generate2FA = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("isTwoFactorEnabled");

    if (user.isTwoFactorEnabled)
      return next(getErrorObject("2FA is already enabled.", 403));

    const secret = generateSecret();
    const otpauthUrl = generateURI({
      issuer: "OwnStorage",
      label: req.user.email,
      secret,
    });
    const qrCodeImage = await qrcode.toDataURL(otpauthUrl);

    // Save temporarily, but don't enable yet!
    await User.findByIdAndUpdate(req.user._id, {
      twoFactorSecret: secret,
      isTwoFactorEnabled: false,
    });

    res.status(200).json({
      success: true,
      data: { qrCode: qrCodeImage, manualSecret: secret },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: POST /api/auth/2fa/enable
 * what it do: Verifies the first scanned code and locks 2FA to true.
 */
export const enable2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.user._id).select(
      "+twoFactorSecret isTwoFactorEnabled",
    );

    if (user.isTwoFactorEnabled)
      return next(getErrorObject("2FA is already enabled.", 403));
    if (!user.twoFactorSecret)
      return next(getErrorObject("2FA setup not initiated.", 400));

    const { valid } = await verify({
      token,
      secret: user.twoFactorSecret,
      digits: 6,
      period: 30,
      epochTolerance: 30,
    });
    if (!valid) return next(getErrorObject("Invalid code. Try again.", 401));

    await User.findByIdAndUpdate(req.user._id, { isTwoFactorEnabled: true });
    await redisClient.del(`storageApp:user:${req.user._id}:userdata`);

    res
      .status(200)
      .json({ success: true, message: "2FA successfully enabled." });
  } catch (err) {
    next(err);
  }
};

/**
 * path: POST /api/auth/2fa/disable
 * what it do: Verifies the current Authenticator code and turns 2FA off.
 */
export const disable2FA = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return next(getErrorObject("Authenticator code required."));

    const user = await User.findById(req.user._id).select(
      "+twoFactorSecret isTwoFactorEnabled",
    );

    if (!user.isTwoFactorEnabled)
      return next(getErrorObject("2FA is not enabled.", 400));
    if (!user.twoFactorSecret)
      return next(getErrorObject("2FA setup not initiated.", 400));

    const { valid } = await verify({
      token,
      secret: user.twoFactorSecret,
      digits: 6,
      period: 30,
      epochTolerance: 30,
    });
    if (!valid) return next(getErrorObject("Invalid code. Try again.", 401));

    await User.findByIdAndUpdate(req.user._id, {
      isTwoFactorEnabled: false,
      twoFactorSecret: null,
    });
    await redisClient.del(`storageApp:user:${req.user._id}:userdata`);

    res
      .status(200)
      .json({ success: true, message: "2FA successfully disabled." });
  } catch (err) {
    next(err);
  }
};

/**
 * path: POST /api/auth/verify-totp
 * what it do: Verifies Authenticator code during login and creates the Redis stateful session.
 */
export const verifyTotpHandler = async (req, res, next) => {
  try {
    const { authToken } = req.signedCookies;
    if (!authToken) return next(getErrorObject("Invalid cookies."));

    const { token: totpCode, logoutLastSession } = req.body;
    if (!totpCode) return next(getErrorObject("Authenticator code required."));

    const { success, data } = await authTokenSchema.safeParseAsync(authToken);
    if (!success || data.purpose !== "login")
      return next(getErrorObject("Invalid session state."));

    const userWithSecret = await User.findById(data.id)
      .select("+twoFactorSecret isTwoFactorEnabled subscription")
      .populate("subscription", "limits.maxDevices")
      .lean();

    if (!userWithSecret?.isTwoFactorEnabled)
      return next(getErrorObject("2FA not enabled."));

    const { valid } = await verify({
      token: totpCode,
      secret: userWithSecret.twoFactorSecret,
      digits: 6,
      period: 30,
      epochTolerance: 30,
    });
    if (!valid) return next(getErrorObject("Invalid Authenticator code."));

    const indexKey = `storageApp:user:${data.id}:session_index`;
    const sessionKeys = await redisClient.sMembers(indexKey);

    const maxDevices = userWithSecret.subscription?.limits?.maxDevices || 1;

    if (sessionKeys.length >= maxDevices) {
      if (logoutLastSession) {
        await redisClient.sRem(indexKey, sessionKeys[0]);
        await redisClient.del(sessionKeys[0]);
      } else {
        throw getErrorObject(
          "Session creation failed. Max. limit reached.",
          413,
        );
      }
    }

    res.clearCookie("authToken");
    const sessionToken = crypto.randomBytes(32).toString("hex");

    let updatedUser = null;
    const _session = await mongoose.startSession();

    try {
      await _session.withTransaction(async () => {
        updatedUser = await User.findByIdAndUpdate(
          data.id,
          { $set: { lastLogin: new Date() } },
          { returnDocument: "after" },
        )
          .populate("root", "_id name size")
          .populate("subscription")
          .session(_session)
          .lean();
      });
    } finally {
      await _session.endSession();
    }

    const userKey = `storageApp:user:${updatedUser._id}:userdata`;
    const redisSessionKey = `storageApp:user:${updatedUser._id}:session:${sessionToken}`;

    const sevenDays = 7 * t._day;
    await Promise.all([
      redisClient.json.set(userKey, "$", updatedUser),
      redisClient.json.set(redisSessionKey, "$", {
        exp: sevenDays,
        createdAt: Date.now(),
        userAgent: req.headers["user-agent"] || "unknown",
      }),
      redisClient.sAdd(indexKey, redisSessionKey),
      redisClient.expire(userKey, 2 * t._min),
      redisClient.expire(redisSessionKey, sevenDays),
      redisClient.expire(indexKey, sevenDays),
    ]);

    setCsrfCookie(res);
    return res
      .cookie(
        "sessionId",
        { token: sessionToken, id: updatedUser._id },
        cookieOptions({ maxAge: sevenDays * 1000, sameSite: "lax" }),
      )
      .status(201)
      .json({
        success: true,
        message: "Session created.",
        data: { user: await getUserPayload(updatedUser) },
      });
  } catch (err) {
    next(err);
  }
};
