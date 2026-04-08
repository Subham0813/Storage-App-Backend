import mongoose from "mongoose";
import * as bcrypt from "bcrypt";
import crypto from "crypto";
import { z } from "zod/v4";

import { TIME, EMAIL_REGEX, MAX_DEVICE_COUNT } from "../misc/constants.js";
import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";
import { OTP } from "../models/otp.model.js";
import { getErrorObject, getUserPayload } from "../utils/helper.js";
import { Session } from "../models/session.model.js";
import {
  authTokenSchema,
  loginSchema,
  registerSchema,
  requestOtpSchema,
  verifyOtpSchema,
} from "../Schemas/authSchema.js";
import { redisClient } from "../configs/radis.js";

const cookieOptions = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  signed: true,
  maxAge: TIME.FIVE_MINUTES,
  path: "/",
};

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
    let otpExpiresAt, deviceLoggedCount;
    otpExpiresAt = deviceLoggedCount = null;

    try {
      await session.withTransaction(async () => {
        const user = await User.findOne({ _id: userId, email })
          .select("isEmailVerified deviceCount")
          .session(session)
          .lean();
        if (!user) throw getErrorObject("Invalid email address or token.", 404);

        const otp = crypto.randomInt(100000, 1000000).toString();

        const otpKey = `storageApp:user:${user._id}:otp:${purpose}`;
        await redisClient.json.set(otpKey, "$", { otp, email });
        await redisClient.expire(otpKey, 300);

        otpExpiresAt = new Date(Date.now() + TIME.FIVE_MINUTES);
        deviceLoggedCount = user.deviceCount;
      });
    } finally {
      session.endSession();
    }

    //await sendEmail({email, purpose, otp})

    return res.status(201).json({
      success: true,
      message: "An One Time Password has been sent to your Email address.",
      data: { otpExpiresAt, deviceLoggedCount },
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
    else if (storedOtp.otp !== otp || storedOtp.email !== email)
      throw getErrorObject("Invalid email or OTP.", 400);

    await redisClient.del(otpKey);
    res.clearCookie("authToken");

    const token = crypto.randomBytes(32).toString("hex");
    if (authToken.purpose === "forgot-password") {
      const resetKey = `storageApp:user:${userId}:resetPass:${token}`;
      await redisClient.set(resetKey, email, { EX: 300 });

      return res
        .cookie("resetToken", { token, id: userId }, cookieOptions)
        .status(200)
        .json({ success: true, message: "OTP verified." });
    }

    let updatedUser = null;
    const indexKey = `storageApp:user:${userId}:session_index`;

    const _session = await mongoose.startSession();
    try {
      await _session.withTransaction(async () => {
        //check for user exists
        const user = await User.findOne({ _id: userId, email })
          .select("isLogged deviceCount")
          .session(_session)
          .lean();
        if (!user) throw getErrorObject("User not found.", 404);

        if (user.deviceCount >= MAX_DEVICE_COUNT) {
          if (logoutLastSession) {
            const sessionKeys = await redisClient.sMembers(indexKey);

            if (sessionKeys.length >= 2) {
              await redisClient.sRem(indexKey, sessionKeys[0]);
              await redisClient.del(sessionKeys[0]);
            }
          } else {
            throw getErrorObject(
              "Session creation failed. Max. limit reached.",
              413,
            );
          }
        }

        const incr = user.deviceCount < MAX_DEVICE_COUNT ? 1 : 0;
        updatedUser = await User.findByIdAndUpdate(
          user._id,
          { $set: { isLogged: true }, $inc: { deviceCount: incr } },
          { returnDocument: "after" },
        )
          .session(_session)
          .lean();
      });
    } finally {
      await _session.endSession();
    }

    const user = getUserPayload(updatedUser);
    const userKey = `storageApp:user:${user._id}:userdata`;
    const sessionKey = `storageApp:user:${user._id}:session:${token}`;

    await Promise.all([
      redisClient.json.set(userKey, "$", updatedUser),
      redisClient.expire(userKey, 300),

      redisClient.set(sessionKey, Date.now(), { EX: 7 * 86400 }),
      redisClient.sAdd(indexKey, sessionKey),
      redisClient.expire(indexKey, 7 * 86400),
    ]);

    return res
      .cookie(
        "sessionId",
        { token, id: user._id },
        {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          signed: true,
          maxAge: TIME.ONE_DAY * 7,
          path: "/",
        },
      )
      .status(201)
      .json({
        success: true,
        message: "Session created.",
        data: { user },
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
    const user = await User.findOne({ email }).select("+password");

    if (!user || !user.password || !(await user.comparePassword(password))) {
      return next(getErrorObject("Incorrect email or password."));
    }

    return res
      .cookie("authToken", { purpose: "login", id: user._id }, cookieOptions)
      .status(200)
      .json({ success: true, message: "Login token created." });
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

    const { fullname, email, password } = data;
    const session = await mongoose.startSession();
    let user = null;
    try {
      await session.withTransaction(async () => {
        const existingUser = await User.findOne({ email }).session(session);
        if (existingUser) throw getErrorObject("User already registered.", 409);

        [user] = await User.create([{ name: fullname, email, password }], {
          session,
        });
        const [root] = await Directory.create(
          [
            {
              dirname: `root-${user.username}`,
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
      .cookie("authToken", { purpose: "register", id: user._id }, cookieOptions)
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

    const user = await User.findOne({ email: data.email }).select("_id").lean();
    if (!user) return next(getErrorObject("User not found.", 404));

    return res
      .cookie(
        "authToken",
        { purpose: "forgot-password", id: user._id },
        cookieOptions,
      )
      .status(200)
      .json({ success: true, message: "Password changing token created." });
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

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await User.updateOne(
          { _id: userId, email: storedEmail },
          { $set: { password: hashedPassword } },
        ).session(session);
      });
    } finally {
      await session.endSession();
    }

    //password changed success message
    //await sendEmail({email, purpose})

    return res
      .clearCookie("resetToken")
      .status(201)
      .json({ success: true, message: "Password changed." });
  } catch (err) {
    next(err);
  }
};
