import path from "path";
import mongoose from "mongoose";
import * as bcrypt from "bcrypt";

import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";
import { OTP } from "../models/otp.model.js";
import { badRequest, notFound } from "../utils/helper.js";
import { createSession } from "../utils/createSession.js";

export const requestOtpHandler = async (req, res, next) => {
  const { email, purpose } = req.body;
  const { authToken } = req.signedCookies;

  if (!email || !purpose) return badRequest(res, "Invalid payload.");

  try {
    if (
      !authToken ||
      !mongoose.isValidObjectId(authToken.id) ||
      authToken.expires < Date.now() ||
      authToken.purpose !== purpose
    )
      return badRequest(res, "Invalid token.");

    //check for user exists
    const user = await User.findOne({ email });
    if (!user || user._id.toString() !== authToken.id)
      return notFound(res, "Incorrect email address.");

    //create & send otp to email
    const otp = await new Promise((resolve) =>
      setTimeout(resolve(Math.floor(100000 + Math.random() * 900000), 1000)),
    );

    //await sendEmail({email, purpose, otp})

    let otpRecord = await OTP.find({ email, purpose });
    if (!otpRecord || otpRecord.length < 3)
      otpRecord = await OTP.create({ email, otp, purpose });
    else return badRequest(res, "Limit exceeds for OTP request.");

    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: "An One Time Password has been sent to your Email address.",
      data: { otp, expiresAt: otpRecord.createdAt.getTime() + 300 * 1000 },
    });
  } catch (err) {
    err.customMessage =
      "One Time Password request failed due to some unavoidable reasons. Try again.";
    next(err);
  }
};

export const verifyOtpHandler = async (req, res, next) => {
  const { email, otp, purpose } = req.body;
  if (!email || !otp) return badRequest(res, "Invalid payload.");

  try {
    //check for user exists
    const user = await User.findOne({ email });
    if (!user) return notFound(res, "Incorrect email address.");

    const otps = await OTP.find({ email, purpose });
    if (otps.length < 1) return notFound(res, "OTP expired.");

    let otpRecord = otps[otps.length - 1];
    const isValid = await otpRecord.compareOTP(otp.toString());
    if (!isValid) return badRequest(res, "Invalid OTP.");

    if (!user.rootDirId) {
      const root = await Directory.create({
        name: `root-${user.username}`,
        parentId: new mongoose.Types.ObjectId(),
        userId: user._id,
      });

      user.rootDirId = root._id;
    }

    user.emailVerified = true;
    await user.save();

    let userPayload = {};

    if (purpose === "forgotPassword") {
      otpRecord.createdAt = Date.now();
      otpRecord = await otpRecord.save();

      const expires = otpRecord.createdAt.getTime() + 300 * 1000;
      return res
        .cookie("oid", otpRecord._id, {
          httpOnly: true,
          sameSite: "strict",
          secure: true,
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

    userPayload = await createSession(user, res);
    await OTP.deleteMany({ email, purpose });
    res.clearCookie("authToken");

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: "OTP verification successful. Session created.",
      data: { user: userPayload },
    });
  } catch (err) {
    err.customMessage =
      "One Time Password verification failed due to some unavoidable reasons. Try again.";
    next(err);
  }
};

export const loginHandler = async (req, res, next) => {
  const { email, password, username } = req.body;
  if ((!email && !password) || (!username && !password) || !password)
    return badRequest(res, "Invalid payload.");

  if (email && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email))
    return badRequest(res, "Invalid email address.");

  try {
    let user = null;

    if (email) {
      user = await User.findOne({ email }).select("+password");
    } else if (username) {
      user = await User.findOne({ username }).select("+password");
    }

    if (!user || !user.password)
      return notFound(res, "Incorrect email or password.");

    if (!(await user.comparePassword(password)))
      return notFound(res, "Incorrect email or password.");

    const expires = Date.now() + 600 * 1000;
    res.cookie(
      "authToken",
      { purpose: "login", id: user._id, expires },
      {
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        signed: true,
        expires: new Date(expires),
        path: "/",
      },
    );

    return res.status(200).json({
      success: true,
      statusCode: 200,
      message: "Login Successful.",
    });
  } catch (err) {
    err.customMessage =
      "Login process failed due to some unavoidable reasons. Try again.";
    next(err);
  }
};

export const registerHandler = async (req, res, next) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) return badRequest(res, "Invalid payload.");

  if (email && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email))
    return badRequest(res, "Invalid email address.");

  try {
    const existUser = await User.findOne({ email });
    if (existUser)
      return res.status(409).json({
        success: false,
        statusCode: 409,
        message: "User already registered.",
        error: "Conflict",
      });

    const user = await User.create({ name, email, password });

    const expires = Date.now() + 600 * 1000;
    res.cookie(
      "authToken",
      { purpose: "register", id: user._id, expires },
      {
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        signed: true,
        expires: new Date(expires),
        path: "/",
      },
    );

    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: "Register successful.",
    });
  } catch (err) {
    err.customMessage =
      "Register process failed due to some unavoidable reasons. Try again.";
    next(err);
  }
};

export const forgotPasswordInitHandler = async (req, res, next) => {
  const { email } = req.body;
  if (!email) return badRequest(res, "Invalid payload.");

  try {
    const user = await User.findOne({ email });
    if (!user) return notFound(res, "Incorrect email address.");

    const expires = new Date(Date.now() + 600 * 1000);
    res.cookie(
      "authToken",
      { purpose: "forgotPassword", id: user._id, expires },
      {
        httpOnly: true,
        sameSite: "strict",
        secure: true,
        signed: true,
        expires: new Date(expires),
        path: "/",
      },
    );

    return res.status(201).json({
      success: true,
      statusCode: 201,
      message: "Request registered.",
    });
  } catch (err) {
    err.customMessage =
      "Forgot password initialization failed due to some unavoidable reasons. Try again.";
    next(err);
  }
};

export const forgotPasswordHandler = async (req, res, next) => {
  const { newPassword } = req.body;
  const { oid } = req.signedCookies;

  if (!newPassword) return badRequest(res, "Invalid payload.");

  if (!oid || !mongoose.isValidObjectId(oid))
    return notFound(res, "Email not verified. Access denied.");

  try {
    const otpRecord = await OTP.findOne({
      _id: oid,
      purpose: "forgotPassword",
    });
    if (!otpRecord) return badRequest(res, "OTP expired.");

    //create hashedPassword
    const hashedPass = await bcrypt.hash(newPassword, 12);

    await User.findOneAndUpdate(
      { email: otpRecord.email },
      { $set: { password: hashedPass } },
      { new: true },
    );

    //password changed success message
    //await sendEmail({email, purpose})

    await otpRecord.deleteOne({ _id: oid });

    return res.clearCookie("oid").status(201).json({
      success: true,
      statusCode: 201,
      message: "Password changed.",
    });
  } catch (err) {
    err.customMessage =
      "Password reset process failed due to some unavoidable reasons. Try again.";
    next(err);
  }
};
