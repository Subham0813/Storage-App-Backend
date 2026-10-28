import mongoose from "mongoose";
import * as bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod/v4";

import { MAX_USER_BANDWIDTH, MAX_USER_QUOTA, t } from "../misc/constants.js";
import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";
import {
  getErrorObject,
  getUserPayload,
  cookieOptions,
  safeCompare,
  getMaxDevices,
  setCsrfCookie,
} from "../utils/helper.js";
import { getBandwidthResetAt } from "../utils/bandwidthWindow.js";
import {
  sendOtpEmail,
  sendPasswordResetConfirmation,
} from "../services/emailService.js";
import {
  authTokenSchema,
  loginSchema,
  registerSchema,
  verifyOtpSchema,
} from "../schemas/authSchema.js";
import { redisClient } from "../configs/redis.js";

const fiveMins = 5 * t._min;
const sevenDays = 7 * t._day;

/**
 * path: /api/auth/verify-otp
 * what it do: Verify the provided OTP for the given purpose. On success, creates session (for login/register) or sets a temporary cookie for password reset.
 * requirements:
 *   - req.body: { email: string, otp: string|number, purpose: string, logoutLastSession?: boolean }
 *   - purpose must be one of ["login","register","forgotPassword"]
 *   - user with given email must exist
 *   - matching OTP record must exist in DB
 */
export const verifyOtpHandler = async (req, res, next) => {
  try {
    const { authToken } = req.signedCookies;
    if (!authToken) return next(getErrorObject("Invalid cookies."));

    const { success, data, error } = await verifyOtpSchema.safeParseAsync(
      req.body,
    );
    const {
      success: authSuccess,
      data: authData,
      error: authError,
    } = await authTokenSchema.safeParseAsync(authToken);

    let errorMessage = !success
      ? error.issues.map((err) => err.message).join(", ")
      : !authSuccess
        ? authError.issues.map((err) => err.message).join(", ")
        : "";

    if (errorMessage.length > 0) return next(getErrorObject(errorMessage));

    const { id: userId, purpose: authPurpose } = authData;
    const { email, otp, logoutLastSession } = data;

    const otpKey = `storageApp:user:${userId}:otp:${authPurpose}`;
    const storedOtp = await redisClient.json.get(otpKey, "$");

    if (!storedOtp) throw getErrorObject("OTP expired.", 410);
    else if (!safeCompare(storedOtp.otp, otp) || storedOtp.email !== email)
      throw getErrorObject("Invalid email or OTP.");

    const token = crypto.randomBytes(32).toString("hex");
    if (authData.purpose === "forgot-password") {
      const resetKey = `storageApp:user:${userId}:resetPass:${token}`;
      await redisClient.set(resetKey, email, { EX: fiveMins });
      await redisClient.del(otpKey);

      return res
        .clearCookie("authToken")
        .cookie(
          "resetToken",
          { token, id: userId },
          cookieOptions({ maxAge: fiveMins * 1000, sameSite: "strict" }),
        )
        .status(200)
        .json({ success: true, message: "OTP verified." });
    }

    const indexKey = `storageApp:user:${userId}:session_index`;
    let user = await User.findOne({ _id: userId, email })
      .populate("subscription", "limits.maxDevices")
      .lean();

    if (!user) throw getErrorObject("User not found.", 404);

    if (user.isDeleted)
      throw getErrorObject(
        "Your account has been banned. Contact support.",
        403,
      );

    if (authPurpose === "login" && user.isTwoFactorEnabled)
      throw getErrorObject("Two-factor authentication required.", 403);

    const sessionKeys = await redisClient.sMembers(indexKey);
    const maxDevices = getMaxDevices(user);

    if (sessionKeys.length >= maxDevices) {
      if (logoutLastSession) {
        // Evict enough sessions to make room
        const evictCount = sessionKeys.length - maxDevices + 1;
        for (const key of sessionKeys.slice(0, evictCount)) {
          await redisClient.sRem(indexKey, key);
          await redisClient.del(key);
        }
      } else {
        throw getErrorObject(
          "Session creation failed. Max. limit reached.",
          413,
        );
      }
    }

    const _session = await mongoose.startSession();
    try {
      await _session.withTransaction(async () => {
        user = await User.findByIdAndUpdate(
          user._id,
          {
            $set: {
              isEmailVerified: true,
              isActive: true,
              isLogged: true,
              lastLogin: new Date(),
            },
          },
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

    const userKey = `storageApp:user:${user._id}:userdata`;
    const sessionKey = `storageApp:user:${user._id}:session:${token}`;

    await Promise.all([
      redisClient.json.set(userKey, "$", user),
      redisClient.json.set(sessionKey, "$", {
        exp: sevenDays,
        createdAt: Date.now(),
        userAgent: req.headers["user-agent"] || "unknown",
      }),
      redisClient.sAdd(indexKey, sessionKey),
      redisClient.expire(userKey, 2 * t._min),
      redisClient.expire(sessionKey, sevenDays),
      redisClient.expire(indexKey, sevenDays),
      redisClient.del(otpKey),
    ]);

    // setCsrfCookie(res);
    return res
      .clearCookie("authToken")
      .cookie(
        "sessionId",
        { token, id: user._id },
        cookieOptions({ maxAge: sevenDays * 1000, sameSite: "lax" }),
      )
      .status(201)
      .json({
        success: true,
        message: "Session created.",
        data: { user: await getUserPayload(user) },
      });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/auth/login
 * what it do: Validate credentials, compute device-cap state, send OTP email (non-2FA) or mark 2FA-required, set a short-lived `authToken` cookie.
 * requirements:
 *   - req.body: { email: string, password: string }
 *   - user must exist and password must match
 */
export const loginHandler = async (req, res, next) => {
  try {
    const { success, data, error } = await loginSchema.safeParseAsync(req.body);
    if (!success) {
      const errorMessage = error.issues.map((err) => err.message).join(", ");
      return next(getErrorObject(errorMessage));
    }

    const { email, password } = data;
    const user = await User.findOne({ email }).select(
      "+password isTwoFactorEnabled isDeleted",
    );

    if (!user || !user.password || !(await user.comparePassword(password))) {
      return next(getErrorObject("Incorrect email or password."));
    }

    if (user.isDeleted)
      return next(
        getErrorObject("Your account has been banned. Contact support.", 403),
      );

    const indexKey = `storageApp:user:${user._id}:session_index`;
    const sessionKeys = await redisClient.sMembers(indexKey);
    const activeSessions = sessionKeys.length;
    const maxDevices = getMaxDevices(user);
    const sessionRemains = maxDevices - activeSessions;
    const sessionLimit = activeSessions >= maxDevices;

    if (user.isTwoFactorEnabled) {
      res.cookie(
        "authToken",
        { purpose: "login", id: user._id },
        cookieOptions({ maxAge: fiveMins * 1000, sameSite: "strict" }),
      );
      return res.status(200).json({
        success: true,
        data: { twoFactorRequired: true, sessionRemains, sessionLimit },
      });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpKey = `storageApp:user:${user._id}:otp:login`;
    await redisClient.json.set(otpKey, "$", { otp, email });
    await redisClient.expire(otpKey, fiveMins);

    res.cookie(
      "authToken",
      { purpose: "login", id: user._id },
      cookieOptions({ maxAge: fiveMins * 1000, sameSite: "strict" }),
    );

    const otpExpiresAt = new Date(Date.now() + fiveMins * 1000);
    sendOtpEmail(user.name, email, otp, "login").catch((err) =>
      console.error("Email sending failed:", err),
    );

    return res.status(200).json({
      success: true,
      message: "OTP sent.",
      data: { otpExpiresAt, sessionRemains, sessionLimit },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/auth/register
 * what it do: Register a new user and set a short-lived `authToken` cookie to allow OTP request/verification for account activation.
 * requirements:
 *   - req.body: { name: string, email: string, password: string }
 *   - `email` must be a valid email format
 *   - email must not already exist in the database
 */
export const registerHandler = async (req, res, next) => {
  try {
    const { success, data, error } = await registerSchema.safeParseAsync(
      req.body,
    );
    if (!success) {
      const errorMessage = error.issues.map((err) => err.message).join(", ");
      return next(getErrorObject(errorMessage));
    }

    const { name, email, password } = data;
    const session = await mongoose.startSession();
    let user = null;
    try {
      await session.withTransaction(async () => {
        const existingUser = await User.findOne({ email }).session(session);
        if (existingUser) throw getErrorObject("User already registered.", 409);

        [user] = await User.create(
          [
            {
              name,
              email,
              password,
              maxQuota: MAX_USER_QUOTA,
              maxBandwidthQuota: MAX_USER_BANDWIDTH,
              bandwidthResetAt: getBandwidthResetAt(),
              isAgeConfirmed: true,
              termsAgreedAt: new Date(),
            },
          ],
          { session },
        );
        const [root] = await Directory.create(
          [
            {
              name: `root-${user.email}`,
              parentId: new mongoose.Types.ObjectId(),
              userId: user._id,
            },
          ],
          { session },
        );

        user = await User.findByIdAndUpdate(
          user._id,
          { root: root._id },
          { session, returnDocument: "after" },
        );
      });
    } finally {
      await session.endSession();
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpKey = `storageApp:user:${user._id}:otp:register`;
    await redisClient.json.set(otpKey, "$", { otp, email });
    await redisClient.expire(otpKey, fiveMins);

    const maxDevices = getMaxDevices(user);
    const otpExpiresAt = new Date(Date.now() + fiveMins * 1000);

    res.cookie(
      "authToken",
      { purpose: "register", id: user._id },
      cookieOptions({ maxAge: fiveMins * 1000, sameSite: "strict" }),
    );
    sendOtpEmail(user.name, email, otp, "register").catch((err) =>
      console.error("Email sending failed:", err),
    );

    return res.status(200).json({
      success: true,
      message: "Activation OTP sent.",
      data: { otpExpiresAt, sessionRemains: maxDevices, sessionLimit: false },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/auth/forgot-password-init
 * what it do: Initiate forgot-password flow by verifying email exists and setting a short-lived `authToken` cookie with purpose `forgotPassword`.
 * requirements:
 *   - req.body: { email: string }
 *   - user with provided email must exist
 */
export const forgotPasswordInitHandler = async (req, res, next) => {
  try {
    const { success, data, error } = await z
      .object({ email: loginSchema.shape.email })
      .safeParseAsync(req.body);

    if (!success) {
      const errorMessage = error.issues.map((err) => err.message).join(", ");
      return next(getErrorObject(errorMessage));
    }

    const { email } = data;
    const user = await User.findOne({ email })
      .select("_id name email isDeleted")
      .lean();
    if (!user) return next(getErrorObject("User not found.", 404));
    if (user.isDeleted)
      return next(
        getErrorObject("Your account has been banned. Contact support.", 403),
      );

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpKey = `storageApp:user:${user._id}:otp:forgot-password`;
    await redisClient.json.set(otpKey, "$", { otp, email });
    await redisClient.expire(otpKey, fiveMins);

    res.cookie(
      "authToken",
      { purpose: "forgot-password", id: user._id },
      cookieOptions({ maxAge: fiveMins * 1000, sameSite: "strict" }),
    );
    const otpExpiresAt = new Date(Date.now() + fiveMins * 1000);
    sendOtpEmail(user.name, email, otp, "forgot-password").catch((err) =>
      console.error("Email sending failed:", err),
    );

    return res.status(200).json({
      success: true,
      message: "Reset code sent.",
      data: { otpExpiresAt },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/auth/forgot-password
 * what it do: Reset the user password using a previously-verified OTP. Requires a signed cookie `resetToken` set by OTP verification.
 * requirements:
 *   - req.body: { newPassword: string }
 *   - req.signedCookies.resetToken: OTP record id (signed cookie) set by `verify-otp` when purpose is `forgotPassword`
 *   - OTP record with given id and purpose `forgotPassword` must exist
 */
export const forgotPasswordHandler = async (req, res, next) => {
  try {
    const { success, data, error } = await z
      .object({ newPassword: loginSchema.shape.password })
      .safeParseAsync(req.body);
    if (!success) {
      const errorMessage = error.issues.map((err) => err.message).join(", ");
      return next(getErrorObject(errorMessage));
    }

    const { newPassword } = data;
    const { resetToken } = req.signedCookies;

    if (!newPassword || !resetToken)
      return next(getErrorObject("Invalid cookies or payload."));

    const { token, id: userId } = resetToken;
    const resetKey = `storageApp:user:${userId}:resetPass:${token}`;
    const storedEmail = await redisClient.get(resetKey);

    if (!storedEmail) return next(getErrorObject("Invalid or expired token."));
    await redisClient.del(resetKey);

    const bannedUser = await User.findOne({ _id: userId, email: storedEmail })
      .select("_id isDeleted")
      .lean();
    if (bannedUser?.isDeleted)
      return next(
        getErrorObject("Your account has been banned. Contact support.", 403),
      );

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const session = await mongoose.startSession();
    let username = "";
    try {
      await session.withTransaction(async () => {
        const user = await User.findOneAndUpdate(
          { _id: userId, email: storedEmail },
          { $set: { password: hashedPassword } },
        ).session(session);

        username = user.name;
      });
    } finally {
      await session.endSession();
    }

    // Revoke all existing sessions so a password reset kicks out every device.
    const indexKey = `storageApp:user:${userId}:session_index`;
    const sessions = await redisClient.sMembers(indexKey);
    if (sessions.length > 0) {
      await redisClient.sRem(indexKey, sessions);
      await redisClient.del(sessions);
    }
    await redisClient.del(`storageApp:user:${userId}:userdata`);

    // Send password reset confirmation email
    sendPasswordResetConfirmation(username, storedEmail).catch((err) =>
      console.error("Email sending failed:", err),
    );

    return res
      .clearCookie("resetToken")
      .status(201)
      .json({ success: true, message: "Password changed." });
  } catch (err) {
    next(err);
  }
};
