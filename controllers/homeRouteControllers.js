import mongoose from "mongoose";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Session } from "../models/session.model.js";
import { File as FileModel } from "../models/file.model.js";
import { getUserPayload } from "../utils/helper.js";

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

/**
 * path: /api/home/user
 * what it do: Return the authenticated user's public payload.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getUserHandler = async (req, res) => {
  try {
    const user = getUserPayload(req.user);
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/home/recents
 * what it do: Return recently updated directories and files for the authenticated user. Accepts optional `days` in body to change cutoff.
 * requirements:
 *   - req.user: authenticated user object
 *   - req.body.days?: number (optional, defaults to 7)
 */
export const getRecentsHandler = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const userEmail = req.user.email;

    // Calculate the cutoff date
    // If req.body.days is 3, we go back 3 days. Default is 7.
    const days = req.body.days || 7;
    const cutoffDate = new Date(Date.now() - days * 24 * 3600 * 1000);

    const queryFilter = {
      isDeleted: false,
      updatedAt: { $gte: cutoffDate },
    };

    // 1. Fetch Owner Data (Parallel execution is faster)
    const [directories, files] = await Promise.all([
      Directory.find({ ...queryFilter, userId }).lean(),
      UserFile.find({ ...queryFilter, userId }).lean(),
    ]);

    return res
      .status(200)
      .json({ success: true, data: { directories, files } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/home/bin
 * what it do: Return directories and files in the authenticated user's bin (soft-deleted by user).
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getBinDirectoryHandler = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const userEmail = req.user.email;
    const [directories, files] = await Promise.all([
      Directory.find({ deletedBy: "user", userId }).lean(),
      UserFile.find({ deletedBy: "user", userId }).lean(),
    ]);

    let sharedDirs = [];
    let sharedFiles = [];

    if (userEmail) {
      const sharedFilter = {
        userId: { $ne: userId },
        sharedWith: {
          $elemMatch: {
            email: userEmail,
            role: "EDITOR",
          },
        },
      };

      [sharedDirs, sharedFiles] = await Promise.all([
        Directory.find({ ...sharedFilter, userId }).lean(),
        UserFile.find({ ...sharedFilter, userId }).lean(),
      ]);
    }

    return res.status(200).json({
      success: true,
      data: {
        user: { directories, files },
        shared: userEmail
          ? { directories: sharedDirs, files: sharedFiles }
          : {},
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/home/shared
 * what it do: Return items (files and directories) shared with the authenticated user.
 * requirements:
 *   - req.user: authenticated user object with `email` and `_id`
 */
export const getSharedWithHandler = async (req, res, next) => {
  const userId = req.user._id;
  const userEmail = req.user.email;
  let sharedFiles = [];
  let sharedDirs = [];

  if (userEmail) {
    const sharedCriteria = {
      isDeleted: false,
      userId: { $ne: userId }, // Don't include own files in "Shared"
      sharedWith: {
        $elemMatch: {
          email: userEmail,
          role: { $in: ["EDITOR", "VIEWER"] },
        },
      },
    };

    [sharedFiles, sharedDirs] = await Promise.all([
      UserFile.find(sharedCriteria).lean(),
      Directory.find(sharedCriteria).lean(),
    ]);
  }

  return res.status(200).json({
    success: true,
    data: {
      sharedData: {
        directories: sharedDirs,
        files: sharedFiles,
      },
    },
  });
};

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
      await User.findOneAndUpdate(
        { _id: req.user._id, deviceCount: { $gt: 0 } },
        { $inc: { deviceCount: -1 } },
        { session },
      );

      await Session.deleteOne({ _id: req.signedCookies.sid }).session(session);
    });

    return res.status(200).clearCookie("sid").json({
      success: true,
      statusCode: 200,
      message: "Logout Successful.",
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
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
      await User.findOneAndUpdate(
        { _id: req.user._id, deviceCount: { $gt: 0 } },
        { $set: { deviceCount: 0 } },
        { session },
      );

      await Session.deleteMany({ userId: user._id }).session(session);
    });

    return res.status(200).clearCookie("sid").json({
      success: true,
      statusCode: 200,
      message: "Logout Successful from all devices.",
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};

/**
 * path: /api/home/delete-profile
 * what it do: Delete the authenticated user's account and all associated data including files and sessions.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const DeleteProfileHandler = async (req, res, next) => {
  const userId = req.user._id;
  const filesToDelete = [];
  const session = await mongoose.startSession();
  try {
    const userFiles = await session.withTransaction(async () => {
      const files = await FileModel.find({ userId }).select("objectKey");

      Promise.all([
        Directory.deleteMany({ userId }).session(session),
        UserFile.deleteMany({ userId }).session(session),
        Session.deleteMany({ userId }).session(session),
        FileModel.deleteMany({ userId }).session(session),
      ]);

      return files;
    });

    userFiles.forEach((file) => {
      const filePath = path.join(
        path.resolve(UPLOAD_ROOT),
        userId.toString(),
        file.meta.objectKey,
      );
      filesToDelete.push(filePath);
    });

    Promise.allSettled(filesToDelete.map((filePath) => unlink(filePath))).then(
      (results) => {
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            console.error(
              `Failed to delete file: ${filesToDelete[index]}`,
              result.reason,
            );
          }
        });
      },
    );

    return res.status(200).clearCookie("sid").json({
      success: true,
      statusCode: 200,
      message: "Account deleted successfully.",
    });
  } catch (err) {
    next(err);
  }
};
