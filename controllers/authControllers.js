import mongoose from "mongoose";
import * as bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod/v4";

import { t } from "../misc/constants.js";
import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";
import {
  getErrorObject,
  getUserPayload,
  cookieOptions,
  safeCompare,
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
  requestOtpSchema,
  verifyOtpSchema,
} from "../schemas/authSchema.js";
import { redisClient } from "../configs/redis.js";

const fiveMins = 5 * t._min;
const sevenDays = 7 * t._day;

/**
 * path: /api/auth/request-otp
 * what it do: Validate an auth token and send a one-time-password (OTP) for the given purpose (login/register/forgotPassword).
 * requirements:
 *   - req.body: { email: string, purpose: string }
 *   - req.signedCookies.authToken: signed cookie present with { id, purpose }
 *   - user with matching email and id must exist
 */
export const requestOtpHandler = async (req, res, next) => {
  try {
    const { authToken } = req.signedCookies;
    if (!authToken) return next(getErrorObject("Invalid cookies."));
    const { success, data, error } = await requestOtpSchema.safeParseAsync(
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
    const { email, purpose } = data;
    if (purpose !== authPurpose) {
      return next(getErrorObject("Purpose not matched with cookie."));
    }

    const session = await mongoose.startSession();
    let otpExpiresAt, activeSessions;
    otpExpiresAt = activeSessions = null;

    let otp = "";
    let username = "";
    try {
      await session.withTransaction(async () => {
        const user = await User.findOne({ _id: userId, email })
          .session(session)
          .lean();
        if (!user) throw getErrorObject("Invalid email address or token.", 404);
        if (user.isDeleted)
          throw getErrorObject(
            "Your account has been banned. Contact support.",
            403,
          );

        if (purpose === "login" && user.isTwoFactorEnabled)
          throw getErrorObject("Two-factor authentication required.", 403);

        otp = crypto.randomInt(100000, 1000000).toString();

        const otpKey = `storageApp:user:${user._id}:otp:${purpose}`;
        await redisClient.json.set(otpKey, "$", { otp, email });
        await redisClient.expire(otpKey, fiveMins);

        const indexKey = `storageApp:user:${userId}:session_index`;
        const sessionKeys = await redisClient.sMembers(indexKey);

        otpExpiresAt = new Date(Date.now() + fiveMins * 1000);
        activeSessions = sessionKeys.length;
        username = user.name;
      });
    } finally {
      session.endSession();
    }

    // Send OTP email
    sendOtpEmail(username, email, otp, purpose).catch((err) =>
      console.error("Email sending failed:", err),
    );

    return res.status(201).json({
      success: true,
      message: "An One Time Password has been sent to your Email address.",
      data: { otpExpiresAt, activeSessions },
    });
  } catch (err) {
    next(err);
  }
};

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

    await redisClient.del(otpKey);
    res.clearCookie("authToken");

    const token = crypto.randomBytes(32).toString("hex");
    if (authData.purpose === "forgot-password") {
      const resetKey = `storageApp:user:${userId}:resetPass:${token}`;
      await redisClient.set(resetKey, email, { EX: fiveMins });

      return res
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
      throw getErrorObject("Your account has been banned. Contact support.", 403);

    if (authPurpose === "login" && user.isTwoFactorEnabled)
      throw getErrorObject("Two-factor authentication required.", 403);

    const sessionKeys = await redisClient.sMembers(indexKey);
    const maxDevices = user.subscription?.limits?.maxDevices || 1;

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

    const _session = await mongoose.startSession();
    try {
      await _session.withTransaction(async () => {
        user = await User.findByIdAndUpdate(
          user._id,
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
    ]);

    setCsrfCookie(res);
    return res
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
 * what it do: Validate credentials and set a short-lived `authToken` cookie to allow OTP request/verification for session creation.
 * requirements:
 *   - req.body: { password: string, email?: string, username?: string }
 *   - either `email` or `username` must be provided along with `password`
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
    // $or: [{ email: userEmail }, { username: username }],
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

    return res
      .cookie(
        "authToken",
        { purpose: "login", id: user._id },
        cookieOptions({ maxAge: fiveMins * 1000, sameSite: "strict" }),
      )
      .status(200)
      .json({
        success: true,
        message: "Login token created.",
        data: { isTwoFactorEnabled: user.isTwoFactorEnabled },
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
              bandwidthResetAt: getBandwidthResetAt(),
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

    return res
      .cookie(
        "authToken",
        { purpose: "register", id: user._id },
        cookieOptions({ maxAge: fiveMins * 1000, sameSite: "strict" }),
      )
      .status(200)
      .json({ success: true, message: "Register token created." });
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

    const user = await User.findOne({ email: data.email })
      .select("_id isDeleted")
      .lean();
    if (!user) return next(getErrorObject("User not found.", 404));
    if (user.isDeleted)
      return next(
        getErrorObject("Your account has been banned. Contact support.", 403),
      );

    return res
      .cookie(
        "authToken",
        { purpose: "forgot-password", id: user._id },
        cookieOptions({ maxAge: fiveMins * 1000, sameSite: "strict" }),
      )
      .status(200)
      .json({
        success: true,
        message: "Reset token created. Proceed to create otp.",
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
