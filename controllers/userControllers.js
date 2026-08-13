import mongoose from "mongoose";
import crypto from "crypto";
import {
  BUCKET_NAME,
  deleteS3Objects,
  PUBLIC_BUCKET_NAME,
  s3Client,
  s3PublicClient,
} from "../services/s3Client.js";
import { getErrorObject, getUserLimits, getUserPayload } from "../utils/helper.js";
import { redisClient } from "../configs/redis.js";
import { User } from "../models/user.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { feedbackSchema, nameSchema } from "../schemas/authSchema.js";
import { uploadCompleteSchema } from "../schemas/userSchema.js";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { t, THUMBNAIL_SIZE } from "../misc/constants.js";
import { Permission } from "../models/permission.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Feedback } from "../models/feedback.model.js";
import { processFeedbackEmails } from "../services/emailService.js";
import { ActivityLog } from "../models/activity_log.model.js";

export const getUserInfo = async (req, res, next) => {
  try {
    const user = await getUserPayload(req.user);
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
};

export const getUsage = async (req, res, next) => {
  try {
    const { maxQuota, usedQuota, maxBandwidthQuota, usedBandwidthQuota } =
      await getUserPayload(req.user);
    return res.status(200).json({
      success: true,
      data: {
        usage: { maxQuota, usedQuota, maxBandwidthQuota, usedBandwidthQuota },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/user/storage
 * what it do: Count all the files that belongs to the user.
 */
export const getUserStats = async (req, res, next) => {
  try {
    if (
      req.params.id &&
      req.user.role !== "admin" &&
      req.user.role !== "super_admin"
    ) {
      return next(getErrorObject("Forbidden.", 403));
    }

    const userId = req.params.id || req.user._id;
    if (!mongoose.isValidObjectId(userId))
      return next(getErrorObject("Invalid user id."));

    // Admin route (/api/admin/storage/:id): load the target user so limits and
    // used quota reflect THAT user, not the admin making the request.
    let targetUser = req.user;
    if (req.params.id) {
      targetUser = await User.findById(userId)
        .populate("root")
        .populate("subscription")
        .lean();
      if (!targetUser) return next(getErrorObject("User not found.", 404));
    }

    // Must cast to ObjectId for Aggregation pipelines
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const totalDirs = await Directory.countDocuments({
      userId,
      isDeleted: false,
    });

    // Aggregation Pipeline
    const stats = await UserFile.aggregate([
      { $match: { userId: userObjectId } }, // Include trashed files as they consume quota
      {
        $group: {
          _id: {
            $switch: {
              branches: [
                {
                  case: { $regexMatch: { input: "$mime", regex: /^image\//i } },
                  then: "images",
                },
                {
                  case: { $regexMatch: { input: "$mime", regex: /^video\//i } },
                  then: "videos",
                },
                {
                  case: {
                    $regexMatch: {
                      input: "$mime",
                      regex: /^application\/pdf|^application\/vnd/i,
                    },
                  },
                  then: "docs",
                },
              ],
              default: "others",
            },
          },
          count: { $sum: 1 },
          size: { $sum: "$size" },
        },
      },
    ]);

    const breakdown = {
      docs: { count: 0, size: 0 },
      images: { count: 0, size: 0 },
      videos: { count: 0, size: 0 },
      others: { count: 0, size: 0 },
    };

    let totalSize = 0;
    let totalFiles = 0;

    // Map the MongoDB stats back to your frontend format
    stats.forEach((stat) => {
      breakdown[stat._id] = { count: stat.count, size: stat.size };
      totalSize += stat.size;
      totalFiles += stat.count;
    });

    const limits = getUserLimits(targetUser);
    const usedQuota = targetUser.root?.size || 0;

    return res.status(200).json({
      success: true,
      data: {
        maxQuota: limits.maxStorage, // Pulled dynamically based on SaaS or Self-Host mode
        usedQuota,
        totalSize,
        totalFiles,
        totalDirs,
        breakdown,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const updateName = async (req, res, next) => {
  try {
    const { success, data, error } = nameSchema.safeParse(req.body.name);
    if (!success) return next(getErrorObject(error.issues[0].message));

    const user = await User.findByIdAndUpdate(req.user._id, {
      $set: { name: data },
    })
      .select("_id")
      .lean();

    if (!user)
      return next(
        getErrorObject("Something went wrong, couldn't update the name"),
        404,
      );

    const userKey = `storageApp:user:${req.user._id.toString()}:userdata`;
    await redisClient.del(userKey);

    return res.status(200).json({
      success: true,
      message: "Name updated successfully.",
      data: { user: { name: data } },
    });
  } catch (err) {
    next(err);
  }
};

export const updateAvatar = async (req, res, next) => {
  try {
    const { success, data, error } =
      uploadCompleteSchema.shape.thumbnailBase64.safeParse(
        req.body.avatarBase64,
      );
    if (!success) return next(getErrorObject(error.issues[0].message));

    const base64Data = data.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.byteLength > THUMBNAIL_SIZE) {
      return next(getErrorObject("Thumbnail size exceeds limit.", 413));
    }

    const avatarKey = `avatars/${req.user._id.toString()}/${Date.now()}.webp`;

    try {
      await s3PublicClient.send(
        new PutObjectCommand({
          Bucket: PUBLIC_BUCKET_NAME,
          Key: avatarKey,
          Body: buffer,
          ContentType: "image/webp",
          CacheControl: `public, max-age=${2 * t._hr * t._ms}`,
          ContentEncoding: "base64",
        }),
      );

      await User.findByIdAndUpdate(req.user._id, { $set: { avatarKey } });
      await redisClient.del(`storageApp:user:${req.user._id}:userdata`);
    } catch (s3Err) {
      console.error(s3Err)
      s3PublicClient
        .send(
          new DeleteObjectsCommand({
            Bucket: PUBLIC_BUCKET_NAME,
            Delete: { Objects: [{ Key: avatarKey }] },
          }),
        )
        .catch(console.error);

      return next(getErrorObject("Avatar upload failed.", 500));
    }

    return res.status(200).json({
      success: true,
      message: "Avatar updated successfully.",
      data: {
        user: { avatarUrl: `${process.env.PUBLIC_BUCKET_CDN}/${avatarKey}` },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/user/logout
 * what it do: Log out the current session by decrementing device count and deleting session cookie.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 *   - req.signedCookies.sid: session id cookie
 */
export const LogoutHandler = async (req, res, next) => {
  const currentSessionKey = `storageApp:user:${req.user._id}:session:${req.sessionToken}`;
  const indexKey = `storageApp:user:${req.user._id}:session_index`;

  try {
    await redisClient.sRem(indexKey, currentSessionKey);
    await redisClient.del(currentSessionKey);
    await redisClient.del(`storageApp:user:${req.user._id}:userdata`);

    return res.status(200).clearCookie("sessionId").clearCookie("csrf").json({
      success: true,
      message: "Logout Successful.",
    });
  } catch (err) {
    next(err);
  }
};
/**
 * path: /api/user/logout-all
 * what it do: Log out from all devices by clearing sessions and deleting all sessions.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const LogoutAllHandler = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const indexKey = `storageApp:user:${req.user._id}:session_index`;
      const sessions = await redisClient.sMembers(indexKey);
      if (sessions.length > 0) {
        await redisClient.sRem(indexKey, sessions);
        await redisClient.del(sessions);
      }
      await redisClient.del(`storageApp:user:${req.user._id}:userdata`);
    });

    return res
      .status(200)
      .clearCookie("sessionId")
      .clearCookie("csrf")
      .json({ success: true, message: "Logout Successful from all devices." });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
};
/**
 * path: /api/user/delete-profile
 * what it do: Delete the authenticated user's account and all associated data including files and sessions.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const deleteProfileHandler = async (req, res, next) => {
  const userId = req.user._id;
  const session = await mongoose.startSession();
  try {
    const files = await UserFile.find({ userId, key: { $exists: true } })
      .select("key size thumbnailKey")
      .populate("userId", "avatarKey")
      .lean();

    const v = new Set();
    const th = new Set();
    files.forEach((f) => {
      if (f.key) v.add(f.key);
      if (f.thumbnailKey) th.add(f.thumbnailKey);
      if (f.userId.avatarKey) th.add(f.userId.avatarKey);
    });

    const filesToDelete = Array.from(v);
    const thumbnailsToDelete = Array.from(th);

    const indexKey = `storageApp:user:${req.user._id}:session_index`;
    const sessions = await redisClient.sMembers(indexKey);
    if (sessions.length > 0) {
      await redisClient.sRem(indexKey, sessions);
      await redisClient.del(sessions);
    }
    await redisClient.del(`storageApp:user:${req.user._id}:userdata`);

    try {
      await session.withTransaction(async () => {
        await User.deleteOne({ _id: userId }).session(session);
        await Directory.deleteMany({ userId }).session(session);
        await UserFile.deleteMany({ userId }).session(session);
        await Permission.deleteMany({ userId }).session(session);
        await Subscription.deleteMany({ user: userId }).session(session);
      });
    } finally {
      await session.endSession();
    }

    if (filesToDelete.length > 0) {
      await deleteS3Objects(filesToDelete).catch((err) =>
        console.error("S3 Deletion failed:", err),
      );
    }

    if (thumbnailsToDelete.length > 0) {
      await deleteS3Objects(thumbnailsToDelete, true).catch((err) =>
        console.error("S3 Deletion failed:", err),
      );
    }

    return res.status(200).clearCookie("sessionId").clearCookie("csrf").json({
      success: true,
      message: "Account deleted successfully.",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/user/revoke-drive-integration
 * what it do: Delete the authenticated user's google drive integration.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const deleteIntegration = async (req, res, next) => {
  try {
    const { modifiedCount } = await User.updateOne(
      { _id: req.user._id },
      { $unset: { "integrations.googleDrive": 1 } },
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

/**
 * path: /api/user/empty-trash
 * what it do: Permanently delete all trashed files and directories for the authenticated user.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const emptyTrash = async (req, res, next) => {
  const userId = req.user._id;
  const session = await mongoose.startSession();

  try {
    const [trashedFiles, trashedDirs] = await Promise.all([
      UserFile.find({ userId, isDeleted: true, deletedBy: "user" })
        .select("key size parentId path")
        .lean(),
      Directory.find({ userId, isDeleted: true, deletedBy: "user" })
        .select("size parentId path _id")
        .lean(),
    ]);

    if (trashedFiles.length === 0 && trashedDirs.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Trash is already empty.",
      });
    }

    const allItemIds = [
      ...trashedFiles.map((f) => f._id),
      ...trashedDirs.map((d) => d._id),
    ];

    const uniqueKeys = [
      ...new Set(trashedFiles.map((f) => f.key).filter((k) => k)),
    ];

    const keysToDelete = [];
    if (uniqueKeys.length > 0) {
      for (const key of uniqueKeys) {
        const remainingCount = await UserFile.countDocuments({
          key,
          _id: { $nin: allItemIds },
          isDeleted: false,
        }).session(session);
        if (remainingCount === 0) keysToDelete.push({ key });
      }
    }

    const ancestorIds = new Set();
    const totalSize = [...trashedFiles, ...trashedDirs].reduce(
      (sum, item) => sum + (item.size || 0),
      0,
    );
    for (const item of [...trashedFiles, ...trashedDirs]) {
      for (const pId of item.path || []) ancestorIds.add(pId.toString());
      if (item.parentId) ancestorIds.add(item.parentId.toString());
    }

    await session.withTransaction(async () => {
      await Permission.deleteMany({ itemId: { $in: allItemIds } }).session(
        session,
      );

      if (ancestorIds.size > 0) {
        await Directory.updateMany(
          {
            _id: {
              $in: [...ancestorIds].map(
                (id) => new mongoose.Types.ObjectId(id),
              ),
            },
          },
          { $inc: { size: -totalSize } },
          { session },
        );
      }

      await UserFile.deleteMany({
        _id: { $in: trashedFiles.map((f) => f._id) },
      }).session(session);
      await Directory.deleteMany({
        _id: { $in: trashedDirs.map((d) => d._id) },
      }).session(session);
    });

    if (keysToDelete.length > 0) {
      try {
        await deleteS3Objects(keysToDelete.map((k) => ({ key: k.key })));
      } catch (s3Err) {
        console.error(`S3 deletion failed during empty trash:`, s3Err.message);
      }
    }

    const userKey = `storageApp:user:${userId.toString()}:userdata`;
    await redisClient.del(userKey);

    return res.status(200).json({
      success: true,
      message: "Trash emptied successfully.",
    });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
};

export const feedbackHandler = async (req, res, next) => {
  try {
    const { success, data, error } = feedbackSchema.safeParse(req.body);
    if (!success) return next(getErrorObject(error.issues[0].message));

    const { category, title, description, screenshotBase64 } = data;
    let screenshotKey = null;

    if (screenshotBase64) {
      const base64Data = screenshotBase64.replace(
        /^data:image\/\w+;base64,/,
        "",
      );
      const buffer = Buffer.from(base64Data, "base64");

      if (buffer.length > THUMBNAIL_SIZE) {
        return next(getErrorObject("Screenshot must be less than 1MB."));
      }

      screenshotKey = `feedback/${req.user._id.toString()}/${Date.now()}.webp`;

      await s3PublicClient.send(
        new PutObjectCommand({
          Bucket: PUBLIC_BUCKET_NAME,
          Key: screenshotKey,
          Body: buffer,
          ContentType: "image/webp",
          // Tagging: "type=feedback",
        }),
      );
    }
    const screenshotUrl = `${process.env.PUBLIC_BUCKET_CDN}/${screenshotKey}`;
    
    await Feedback.create({ userId: req.user._id, category, title, description, screenshotKey});
    processFeedbackEmails(req.user, category, title, description, screenshotUrl).catch(console.error);

    return res.status(201).json({
      success: true,
      message: "Bug report submitted successfully.",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/user/activity
 * what it do: Return recent activity log entries for the authenticated user.
 */
export const getActivity = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);

    const items = await ActivityLog.find({ userId: req.user._id }).select("-_id -__v").sort({ createdAt: -1 }).limit(limit).lean();
    
    return res.status(200).json({
      success: true,
      data: { items },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: GET /api/user/sessions
 * what it do: Return all active sessions for the authenticated user with device metadata.
 */
export const getActiveSessionsHandler = async (req, res, next) => {
  try {
    const indexKey = `storageApp:user:${req.user._id}:session_index`;
    const sessionKeys = await redisClient.sMembers(indexKey);

    const hashOf = (token) =>
      crypto.createHash("sha256").update(token).digest("hex");

    const sessions = [];
    for (const key of sessionKeys) {
      const data = await redisClient.json.get(key);
      if (!data) continue;
      const token = key.split(":session:")[1];
      sessions.push({
        id: hashOf(token),
        createdAt: data.createdAt || null,
        userAgent: data.userAgent || "unknown",
        isCurrent: hashOf(token) === hashOf(req.sessionToken),
      });
    }

    sessions.sort((a, b) => {
      if (a.isCurrent) return -1;
      if (b.isCurrent) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    return res.status(200).json({
      success: true,
      data: { sessions },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: DELETE /api/user/sessions/:sessionId
 * what it do: Revoke a specific session by its hashed token.
 */
export const revokeSessionHandler = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const indexKey = `storageApp:user:${req.user._id}:session_index`;
    const sessionKeys = await redisClient.sMembers(indexKey);

    const hashOf = (token) =>
      crypto.createHash("sha256").update(token).digest("hex");

    const match = sessionKeys.find(
      (key) => hashOf(key.split(":session:")[1]) === sessionId,
    );
    if (!match) return next(getErrorObject("Session not found.", 404));

    await redisClient.sRem(indexKey, match);
    await redisClient.del(match);

    const isCurrentSession = hashOf(req.sessionToken) === sessionId;

    return res
      .status(200)
      .json({
        success: true,
        message: isCurrentSession ? "Current session revoked." : "Session revoked.",
        data: { isCurrentSession },
      });
  } catch (err) {
    next(err);
  }
};
