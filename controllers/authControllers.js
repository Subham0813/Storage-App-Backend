import mongoose from "mongoose";
import * as bcrypt from "bcrypt";

import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";
import { OTP } from "../models/otp.model.js";
import {
  badRequest,
  getUserPayload,
  notFound,
  responsePayload,
} from "../utils/helper.js";
import { createSession } from "../utils/createSession.js";
import { Session } from "../models/session.model.js";

const MAX_DEVICE_COUNT = process.env.MAX_DEVICE_COUNT || 2;

/**
 * path: /api/auth/request-otp
 * what it do: Validate an auth token and send a one-time-password (OTP) for the given purpose (login/register/forgotPassword).
 * requirements:
 *   - req.body: { email: string, purpose: string }
 *   - req.signedCookies.authToken: signed cookie present with { id, purpose, expires }
 *   - user with matching email and id must exist
 */
export const requestOtpHandler = async (req, res, next) => {
  const { email, purpose } = req.body;
  const { authToken } = req.signedCookies;

  if (!email || !purpose) return badRequest(res, "Invalid payload.");

  if (
    !authToken ||
    !mongoose.isValidObjectId(authToken.id) ||
    authToken.expires < Date.now() ||
    authToken.purpose !== purpose
  )
    return badRequest(res, "Invalid token.");

  const session = await mongoose.startSession();

  try {
    const { user, otp, otpRecord } = await session.withTransaction(async () => {
      //check for user exists
      const user = await User.findOne({ email })
        .select("emailVerified deviceCount")
        .session(session);

      if (!user || user._id.toString() !== authToken.id) {
        const error = new Error("Incorrect email address.");
        error.statusCode = 404;
        throw error;
      }

      //create & send otp to email
      const otp = await new Promise((resolve) =>
        setTimeout(
          () => resolve(Math.floor(100000 + Math.random() * 900000)),
          1000,
        ),
      );

      //await sendEmail({email, purpose, otp})
      //user.emailVerified = true; await user.save();

      let existingOtps = await OTP.find({ email, purpose }).session(session);
      if (existingOtps.length >= 3) {
        const error = new Error("Limit exceeds for OTP request.");
        error.statusCode = 429;
        throw error;
      }

      const newOtpRecord = await OTP.create([{ email, otp, purpose }], {
        session,
      });

      return {
        otp,
        otpRecord: newOtpRecord[0], // .create returns an array
        user,
      };
    });

    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: "An One Time Password has been sent to your Email address.",
      data: {
        otp,
        expiresAt: otpRecord.createdAt.getTime() + 300 * 1000,
        deviceLoggedCount: user.deviceCount,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return responsePayload(res, err.statusCode, err.message);
    }
    err.customMessage =
      "One Time Password request failed due to some unavoidable reasons. Try again.";
    next(err);
  } finally {
    session.endSession();
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
  const { email, otp, purpose, logoutLastSession } = req.body;
  const allowedPurpose = ["login", "register", "forgotPassword"];
  if (
    !email ||
    !otp ||
    !purpose ||
    typeof purpose !== "string" ||
    !allowedPurpose.includes(purpose) ||
    (purpose === "login" && typeof logoutLastSession !== "boolean")
  )
    return badRequest(res, "Invalid payload.");

  let updatedOtpRecord = null;
  let updatedUserRecord = null;
  let newUserSession = null;

  const _session = await mongoose.startSession();
  try {
    await _session.withTransaction(async () => {
      //check for user exists
      const user = await User.findOne({
        email: email.toLowerCase().trim(),
      })
        .session(_session)
        .lean();

      if (!user) {
        const error = new Error("Incorrect email address.");
        error.statusCode = 404;
        throw error;
      }

      if (user.deviceCount >= MAX_DEVICE_COUNT) {
        if (logoutLastSession) {
          await Session.deleteOne({ userId: user._id })
            .sort({ createdAt: 1 })
            .session(_session);
        } else {
          const error = new Error(
            "Session creation failed. Max.session limit reached.",
          );
          error.statusCode = 413;
          throw error;
        }
      }

      const otps = await OTP.find({ email, purpose }).session(_session);
      if (otps.length < 1) {
        const error = new Error("OTP expired.");
        error.statusCode = 400;
        throw error;
      }

      let otpRecord = otps[otps.length - 1];
      const isValid = await otpRecord.compareOTP(otp.toString());
      if (!isValid) {
        const error = new Error("Invalid OTP.");
        error.statusCode = 404;
        throw error;
      }

      const updateQuery = {};
      if (!user.isLogged) updateQuery["$set"] = { isLogged: true };
      if (user.deviceCount < MAX_DEVICE_COUNT)
        updateQuery["$inc"] = { deviceCount: 1 };

      if (purpose === "forgotPassword") {
        updatedOtpRecord = await OTP.findByIdAndUpdate(
          otpRecord._id,
          { createdAt: new Date() },
          { new: true },
        )
          .select("createdAt")
          .session(_session)
          .lean();
      } else {
        const incr = user.deviceCount < MAX_DEVICE_COUNT ? 1 : 0;
        updatedUserRecord = await User.findOneAndUpdate(
          { _id: user._id },
          { $set: { isLogged: true }, $inc: { deviceCount: incr } },
          { new: true },
        )
          .session(_session)
          .lean();
        await OTP.deleteMany({ email, purpose }).session(_session);

        const ns = await Session.create([{ userId: user._id }], {
          session: _session,
        });

        newUserSession = ns[0];
      }
    });

    if (purpose === "forgotPassword") {
      const expires = updatedOtpRecord.createdAt.getTime() + 300 * 1000;
      return res
        .cookie("oid", updatedOtpRecord._id, {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          signed: true,
          expires: new Date(expires),
          path: "/",
        })
        .status(201)
        .json({
          success: true,
          statusCode: 201,
          message: "OTP verified.",
        });
    }
    // console.log({updatedUserRecord, newUserSession, updatedOtpRecord})

    const userPayload = getUserPayload(updatedUserRecord);
    const { _id: sid, expiry } = newUserSession;

    return res
      .clearCookie("authToken")
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
        statusCode: 200,
        message: "OTP verification successful. Session created.",
        data: { user: userPayload },
      });
  } catch (err) {
    if (err.statusCode) {
      return responsePayload(res, err.statusCode, err.message);
    }
    err.customMessage =
      "One Time Password verification failed due to some unavoidable reasons. Try again.";
    next(err);
  } finally {
    await _session.endSession();
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
  const { email, password } = req.body;
  if (!password || !email) return badRequest(res, "Invalid payload.");

  try {
    const userEmail = email ? email.toLowerCase().trim() : null;

    // $or: [{ email: userEmail }, { username: username }],
    const user = await User.findOne({ email: userEmail }).select("+password");

    if (!user || !user.password || !(await user.comparePassword(password))) {
      const error = new Error("User does not exist with these credentials.");
      error.statusCode = 404;
      throw error;
    }

    const expires = Date.now() + 600 * 1000;
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
      .json({
        success: true,
        statusCode: 200,
        message:
          "Login token created. Request otp and verify to create session.",
      });
  } catch (err) {
    if (err.statusCode) {
      return responsePayload(res, err.statusCode, err.message);
    }
    err.customMessage =
      "Login process failed due to some unavoidable reasons. Try again.";
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
  const { name, email, password } = req.body;

  if (
    !name ||
    !email ||
    !password ||
    !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)
  )
    return badRequest(res, "Invalid payload.");

  const session = await mongoose.startSession();
  try {
    const { user } = await session.withTransaction(async () => {
      const existingUser = await User.findOne({ email }).session(session);
      if (existingUser) {
        const error = new Error("User already registered.");
        error.statusCode = 409;
        throw error;
      }

      let [user] = await User.create([{ name, email, password }], { session });
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

      user = await User.findByIdAndUpdate(user._id, {
        rootDirId: root._id,
      }).session(session);

      return { user };
    });

    const expires = Date.now() + 600 * 1000;
    return res
      .cookie(
        "authToken",
        { purpose: "register", id: user._id, expires },
        {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          signed: true,
          expires: new Date(expires),
          path: "/",
        },
      )
      .status(201)
      .json({
        success: true,
        statusCode: 201,
        message:
          "Register token created. Request otp and verify to create session.",
      });
  } catch (err) {
    if (err.statusCode) {
      return responsePayload(res, err.statusCode, err.message);
    }
    err.customMessage =
      "Register process failed due to some unavoidable reasons. Try again.";
    next(err);
  } finally {
    await session.endSession();
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
  const { email } = req.body;
  if (!email) return badRequest(res, "Invalid payload.");

  try {
    const user = await User.findOne({ email });
    if (!user) return notFound(res, "Incorrect email address.");

    const expires = new Date(Date.now() + 600 * 1000);
    return res
      .cookie(
        "authToken",
        { purpose: "forgotPassword", id: user._id, expires },
        {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          signed: true,
          expires: new Date(expires),
          path: "/",
        },
      )
      .status(201)
      .json({
        success: true,
        statusCode: 201,
        message: "Password changing token created.",
      });
  } catch (err) {
    err.customMessage =
      "Forgot password initialization failed due to some unavoidable reasons. Try again.";
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
  const { newPassword } = req.body;
  const { oid } = req.signedCookies;

  if (!newPassword) return badRequest(res, "Invalid payload.");

  if (!oid || !mongoose.isValidObjectId(oid))
    return notFound(res, "Invalid cookies.");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const otpRecord = await OTP.findOne({
        _id: oid,
        purpose: "forgotPassword",
      })
        .select("email")
        .session(session);

      if (!otpRecord) {
        const error = new Error("Invalid OTP.");
        error.statusCode = 404;
        throw error;
      }

      //create hashedPassword
      const hashedPass = await bcrypt.hash(newPassword, 12);

      await User.findOneAndUpdate(
        { email: otpRecord.email },
        { $set: { password: hashedPass } },
      ).session(session);

      //password changed success message
      //await sendEmail({email, purpose})

      await otpRecord.deleteOne({ _id: oid }).session(session);
    });

    return res.clearCookie("oid").status(201).json({
      success: true,
      statusCode: 201,
      message: "Password changed.",
    });
  } catch (err) {
    if (err.statusCode) {
      return responsePayload(res, err.statusCode, err.message);
    }
    err.customMessage =
      "Password reset process failed due to some unavoidable reasons. Try again.";
    next(err);
  } finally {
    await session.endSession();
  }
};
