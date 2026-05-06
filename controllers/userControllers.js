import mongoose from "mongoose";
import { deleteS3Objects } from "../configs/s3Client.js";
import { getErrorObject } from "../utils/helper.js";
import { redisClient } from "../configs/radis.js";
import { User } from "../models/user.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";

/**
 * path: /api/home/logout
 * what it do: Log out the current session by decrementing device count and deleting session cookie.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 *   - req.signedCookies.sid: session id cookie
 */
export const LogoutHandler = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await User.updateOne(
        { _id: req.user._id, deviceCount: { $gt: 0 } },
        { $inc: { deviceCount: -1 }, $set: { isLogged: false } },
        { session },
      );

      const indexKey = `storageApp:user:${req.user._id}:session_index`;
      const sessions = await redisClient.sMembers(indexKey);
      if (sessions.length > 0) {
        await redisClient.sRem(indexKey, sessions[0]);
        await redisClient.del(sessions[0]);
      }
    });

    return res.status(200).clearCookie("sessionId").json({
      success: true,
      message: "Logout Successful.",
    });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
};
/**
 * path: /api/home/logout-all
 * what it do: Log out from all devices by clearing deviceCount and deleting all sessions.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const LogoutAllHandler = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await User.updateOne(
        { _id: req.user._id, deviceCount: { $gt: 0 } },
        { $set: { deviceCount: 0 } },
        { session },
      );

      const indexKey = `storageApp:user:${req.user._id}:session_index`;
      const sessions = await redisClient.sMembers(indexKey);
      if (sessions.length > 0) {
        await redisClient.sRem(indexKey, sessions);
        await redisClient.del(sessions);
      }
    });

    return res
      .status(200)
      .clearCookie("sessionId")
      .json({ success: true, message: "Logout Successful from all devices." });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
};
/**
 * path: /api/home/delete-profile
 * what it do: Delete the authenticated user's account and all associated data including files and sessions.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const deleteProfileHandler = async (req, res, next) => {
  const userId = req.user._id;
  const session = await mongoose.startSession();
  try {
    const files = await UserFile.find({ userId, key: { $exists: true } })
      .select("-_id key, size")
      .lean();

    const v = new Set();
    const filesToDelete = files.filter(({ key, size }) => {
      if (key && !v.has(key)) {
        v.add(key);
        return { key, size };
      }
    });

    await deleteS3Objects(filesToDelete);
    try {
      await session.withTransaction(async () => {
        await User.deleteOne({ _id: userId }).session(session);
        await Directory.deleteMany({ userId }).session(session);
        await UserFile.deleteMany({ userId }).session(session);
      });
    } finally {
      await session.endSession();
    }

    return res.status(200).clearCookie("sessionId").json({
      success: true,
      message: "Account deleted successfully.",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/home/revoke-drive-integration
 * what it do: Delete the authenticated user's google drive integration.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const deleteIntegration = async (req, res, next) => {
  try {
    const { modifiedCount } = await User.updateOne(
      { _id: req.user._id },
      { $set: { "integration.googleDrive": {} } },
    );
    if (modifiedCount === 0)
      return next(getErrorObject("Integration not found.", 404));

    return res.status(200).json({
      success: true,
      message: "Drive integration deleted.",
    });
  } catch (error) {
    next(error);
  }
};
