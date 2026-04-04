import mongoose from "mongoose";
import * as bcrypt from "bcrypt";
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

/**
 * path: /api/auth/request-otp
 * what it do: Validate an auth token and send a one-time-password (OTP) for the given purpose (login/register/forgotPassword).
 * requirements:
 *   - req.body: { email: string, purpose: string }
 *   - req.signedCookies.authToken: signed cookie present with { id, purpose, expires }
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

    const { id: authId, purpose: authPurpose } = authData;
    const { email, purpose } = data;
    if (purpose !== authPurpose) {
      return next(getErrorObject("Purpose not matched with cookie."));
    }

    const session = await mongoose.startSession();
    let newOtp, otpExpiresAt, deviceLoggedCount;
    newOtp = otpExpiresAt = deviceLoggedCount = null;

    try {
      await session.withTransaction(async () => {
        const user = await User.findOne({ _id: authId, email })
          .select("isEmailVerified deviceCount")
          .session(session)
          .lean();
        if (!user) throw getErrorObject("Invalid email address or token.", 404);

        let existingOtps = await OTP.find({ email, purpose, userId: user._id })
          .session(session)
          .select("_id")
          .lean();
        if (existingOtps.length >= 3) {
          throw getErrorObject("Limit exceeds for OTP request.", 429);
        }

        newOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const [newOtpRecord] = await OTP.create(
          [{ userId: user._id, email, otp: newOtp, purpose }],
          { session },
        );

        otpExpiresAt = new Date(
          newOtpRecord.createdAt.getTime() + TIME.FIVE_MINUTES,
        );
        deviceLoggedCount = user.deviceCount;
      });
    } finally {
      session.endSession();
    }

    //await sendEmail({email, purpose, otp})

    return res.status(201).json({
      success: true,
      message: "An One Time Password has been sent to your Email address.",
      data: { newOtp, otpExpiresAt, deviceLoggedCount },
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

    const { id: authId, purpose: authPurpose } = authData;
    const { email, otp, logoutLastSession } = data;

    let updatedOtpRecord, updatedUserRecord, newUserSession;
    updatedOtpRecord = updatedUserRecord = newUserSession = null;

    const _session = await mongoose.startSession();
    try {
      await _session.withTransaction(async () => {
        //check for user exists
        const user = await User.findOne({
          _id: authId,
          email: email.toLowerCase().trim(),
        })
          .select("isLogged deviceCount")
          .session(_session)
          .lean();

        if (!user) throw getErrorObject("User not found.", 404);

        if (
          authPurpose !== "forgot-password" &&
          user.deviceCount >= MAX_DEVICE_COUNT
        ) {
          if (logoutLastSession) {
            await Session.deleteOne({ userId: user._id }).session(_session);
          } else {
            throw getErrorObject(
              "Session creation failed. Max. limit reached.",
              413,
            );
          }
        }

        const otpRecord = await OTP.findOne({
          userId: user._id,
          email,
          purpose: authPurpose,
        })
          .sort({ createdAt: -1 })
          .session(_session);
        if (!otpRecord) throw getErrorObject("OTP expired.", 410);

        const isValid = await otpRecord.compareOTP(otp.toString());
        if (!isValid) throw getErrorObject("Invalid OTP.", 400);

        const updateQuery = {};
        if (!user.isLogged) updateQuery["$set"] = { isLogged: true };
        if (user.deviceCount < MAX_DEVICE_COUNT)
          updateQuery["$inc"] = { deviceCount: 1 };

        if (authPurpose === "forgot-password") {
          updatedOtpRecord = await OTP.findByIdAndUpdate(
            otpRecord._id,
            { createdAt: new Date() },
            { returnDocument: "after" },
          )
            .select("createdAt")
            .session(_session)
            .lean();
        } else {
          const incr = user.deviceCount < MAX_DEVICE_COUNT ? 1 : 0;
          updatedUserRecord = await User.findByIdAndUpdate(
            user._id,
            { $set: { isLogged: true }, $inc: { deviceCount: incr } },
            { returnDocument: "after" },
          )
            .session(_session)
            .lean();
          await OTP.deleteMany({
            userId: user._id,
            email,
            purpose: authToken.purpose,
          }).session(_session);

          [newUserSession] = await Session.create([{ userId: user._id }], {
            session: _session,
          });
        }
      });
    } finally {
      await _session.endSession();
    }

    if (authToken.purpose === "forgot-password") {
      const expires = updatedOtpRecord.createdAt.getTime() + TIME.FIVE_MINUTES;
      return res
        .cookie("oid", updatedOtpRecord._id, {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          signed: true,
          expires: new Date(expires),
          path: "/",
        })
        .status(200)
        .json({
          success: true,
          message: "OTP verified.",
        });
    }
    // console.log({updatedUserRecord, newUserSession, updatedOtpRecord})

    const userPayload = getUserPayload(updatedUserRecord);
    const { _id: sid, expiry } = newUserSession;
    res.clearCookie("authToken");

    return res
      .cookie("sid", sid, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        signed: true,
        expires: new Date(expiry),
        path: "/",
      })
      .status(201)
      .json({
        success: true,
        message: "Session created.",
        data: { user: userPayload },
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

    const expires = Date.now() + TIME.TEN_MINUTES;
    return res
      .cookie(
        "authToken",
        { purpose: "login", id: user._id, expires },
        {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          signed: true,
          expires: new Date(expires),
          path: "/",
        },
      )
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

    const expires = Date.now() + TIME.TEN_MINUTES;
    return res
      .cookie(
        "authToken",
        { purpose: "register", id: user?._id, expires },
        {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          signed: true,
          expires: new Date(expires),
          path: "/",
        },
      )
      .status(200)
      .json({
        success: true,
        message: "Register token created.",
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

    const user = await User.findOne({ email: data.email });
    if (!user) return next(getErrorObject("User not found.", 404));

    const expires = Date.now() + TIME.TEN_MINUTES;
    return res
      .cookie(
        "authToken",
        { purpose: "forgot-password", id: user._id, expires },
        {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          signed: true,
          expires: new Date(expires),
          path: "/",
        },
      )
      .status(200)
      .json({
        success: true,
        message: "Password changing token created.",
      });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/auth/forgot-password
 * what it do: Reset the user password using a previously-verified OTP. Requires a signed cookie `oid` set by OTP verification.
 * requirements:
 *   - req.body: { newPassword: string }
 *   - req.signedCookies.oid: OTP record id (signed cookie) set by `verify-otp` when purpose is `forgotPassword`
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
    const { oid } = req.signedCookies;

    if (!newPassword || !oid || !mongoose.isValidObjectId(oid))
      return next(getErrorObject("Invalid cookies or payload."));

    const session = await mongoose.startSession();

    //create hashedPassword
    const hashedPass = await bcrypt.hash(newPassword, 12);
    try {
      await session.withTransaction(async () => {
        const otpRecord = await OTP.findOne({
          _id: oid,
          purpose: "forgot-password",
        })
          .select("email")
          .session(session);

        if (!otpRecord) throw getErrorObject("Invalid OTP.", 404);

        await User.updateOne(
          { email: otpRecord.email },
          { $set: { password: hashedPass } },
        ).session(session);

        await otpRecord.deleteOne({ _id: oid }).session(session);
      });
    } finally {
      await session.endSession();
    }

    //password changed success message
    //await sendEmail({email, purpose})

    return res
      .clearCookie("oid")
      .status(201)
      .json({ success: true, message: "Password changed." });
  } catch (err) {
    next(err);
  }
};
