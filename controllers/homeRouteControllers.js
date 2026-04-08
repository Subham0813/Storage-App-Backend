import mongoose from "mongoose";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Session } from "../models/session.model.js";
import { File } from "../models/file.model.js";
import { getUserPayload } from "../utils/helper.js";
import { User } from "../models/user.model.js";
import { DriveIntegration } from "../models/integration.model.js";
import { UPLOAD_ROOT } from "../misc/constants.js";

/**
 * path: /api/home/user
 * what it do: Return the authenticated user's public payload.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getUserHandler = async (req, res, next) => {
  try {
    const user = getUserPayload(req.user);
    user.integrations = Object.keys(req.user.integrations || {});
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

    // Calculate the cutoff date
    // If req.body.days is 3, we go back 3 days. Default is 7.
    const days = req.body.days || 7;
    const cutoffDate = new Date(Date.now() - days * 24 * 3600 * 1000);

    const filter = {
      _id: { $ne: req.user.root },
      userId,
      isDeleted: false,
      updatedAt: { $gte: cutoffDate },
    };
    const projectionStr =
      "-__v -sharedBy -deletedBy -deletedAt -shareToken -sharedAt -sharedWith -publicRole -meta -isDeleted";

    const [files] = await Promise.all([
      // Directory.find(filter).select(projectionStr).lean(),
      UserFile.find(filter).select(`${projectionStr}`).lean(),
    ]);

    return res.status(200).json({ success: true, data: { files } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/home/starred
 * what it do: Return starred directories and files for the authenticated user.
 * requirements:
 *   - req.user: authenticated user object
 */
export const getStarredItems = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const filter = {
      userId,
      isDeleted: false,
      isStarred: true,
    };
    const projectionStr =
      "-__v -sharedBy -deletedBy -deletedAt -shareToken -sharedAt -sharedWith -publicRole -isDeleted";

    const [dirs, files] = await Promise.all([
      Directory.find(filter).select(projectionStr).lean(),
      UserFile.find(filter).select(`${projectionStr} -meta`).lean(),
    ]);

    return res
      .status(200)
      .json({ success: true, data: { directories: dirs, files } });
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
    const projectionStr =
      "-__v -sharedBy -deletedBy -deletedAt -shareToken -sharedAt -sharedWith -publicRole -isDeleted";

    const [directories, files] = await Promise.all([
      Directory.find({ deletedBy: "user", userId })
        .select(projectionStr)
        .lean(),
      UserFile.find({ deletedBy: "user", userId })
        .select(`${projectionStr} -meta`)
        .lean(),
    ]);

    let sharedDirs = [];
    let sharedFiles = [];

    if (userEmail) {
      const sharedFilter = {
        isDeleted: true,
        deletedBy: "user",
        userId: { $ne: userId },
        sharedWith: {
          $elemMatch: {
            email: userEmail,
            role: "EDITOR",
          },
        },
      };

      [sharedDirs, sharedFiles] = await Promise.all([
        Directory.find(sharedFilter).select(projectionStr).lean(),
        UserFile.find(sharedFilter).select(`${projectionStr} -meta`).lean(),
      ]);
    }

    return res.status(200).json({
      success: true,
      data: {
        user: { directories, files },
        shared: { directories: sharedDirs, files: sharedFiles },
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

  const limit = parseInt(req.query.limit) || parseInt(req.body.limit) || 50;
  const skip = parseInt(req.query.skip) || parseInt(req.body.limit) || 0;

  const sharedCriteria = {
    isDeleted: false,
    sharedBy: "user",
    userId: { $ne: userId },
    sharedWith: {
      $elemMatch: {
        email: userEmail,
        role: { $in: ["EDITOR", "VIEWER"] },
      },
    },
  };

  const ownedCriteria = { isDeleted: false, sharedBy: "user", userId };
  const projectionStr =
    "-__v -sharedBy -deletedBy -deletedAt -shareToken -sharedAt -sharedWith -publicRole -isDeleted";

  const [withMeFiles, withMeDirs, byMeFiles, byMeDirs] = await Promise.all([
    UserFile.find(sharedCriteria)
      .select(`${projectionStr} -meta`)
      .skip(skip)
      .limit(limit)
      .lean(),
    Directory.find(sharedCriteria)
      .select(projectionStr)
      .skip(skip)
      .limit(limit)
      .lean(),

    UserFile.find(ownedCriteria)
      .select(projectionStr)
      .skip(skip)
      .limit(limit)
      .lean(),
    Directory.find(ownedCriteria)
      .select(`${projectionStr} -meta`)
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return res.status(200).json({
    success: true,
    data: {
      sharedWithMe: {
        directories: withMeDirs,
        files: withMeFiles,
      },
      sharedByMe: {
        directories: byMeDirs,
        files: byMeFiles,
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
      await User.updateOne(
        { _id: req.user._id, deviceCount: { $gt: 0 } },
        { $inc: { deviceCount: -1 }, $set: { isLogged: false } },
        { session },
      );

      await Session.deleteOne({ _id: req.signedCookies.sid }).session(session);
    });

    return res.status(200).clearCookie("sid").json({
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

      await Session.deleteMany({ userId: req.user._id }).session(session);
    });

    return res
      .status(200)
      .clearCookie("sid")
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
  const filesToDelete = [];
  const session = await mongoose.startSession();
  try {
    const files = await File.find({ userId }).select("objectKey").lean();

    try {
      await session.withTransaction(async () => {
        await User.deleteOne({ _id: userId }).session(session);
        await Directory.deleteMany({ userId }).session(session);
        await UserFile.deleteMany({ userId }).session(session);
        await Session.deleteMany({ userId }).session(session);
        await File.deleteMany({ userId }).session(session);
      });
    } finally {
      await session.endSession();
    }

    files.forEach((file) => {
      const filePath = path.join(
        path.resolve(UPLOAD_ROOT),
        userId.toString(),
        file.objectKey,
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
export const deleteDriveIntegration = async (req, res, next) => {
  try {
    await DriveIntegration.deleteOne({ userId: req.user._id });

    return res.status(200).json({
      success: true,
      message: "Drive integration deleted.",
    });
  } catch (error) {
    next(error);
  }
};
