import archiver from "archiver";
import mongoose from "mongoose";
import { Transform } from "stream";

import { recursiveDelete } from "../utils/remove.js";
import { serveZipS3, sanitizeName } from "../utils/serve.js";
import {
  getErrorObject,
  attachPermissionsCount,
  getFileDoc,
  getUserLimits,
} from "../utils/helper.js";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { filenameSchema } from "../schemas/userSchema.js";
import { deleteS3Objects } from "../services/s3Client.js";
import { redisClient } from "../configs/redis.js";
import { promise } from "zod";
import { logActivity } from "../utils/activityLogger.js";
import { User } from "../models/user.model.js";
import { PLAN_DETAILS } from "../misc/constants.js";
import { ensureBandwidthWindow } from "../utils/bandwidthWindow.js";

const MAX_CONCURRENT_DOWNLOADS = 3;

/**
 * path: /api/directories/:id
 * what it do: List child directories of the given parent directory id if access allowed.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getDirectoriesHandler = async (req, res, next) => {
  const lim = parseInt(req.query?.limit);
  const limit = lim > 0 && lim <= 100 ? lim : 50;

  const cursor = req.query?.cursor;
  if (cursor && !mongoose.isValidObjectId(cursor))
    return next(getErrorObject("Invalid id."));

  try {
    const query = { parentId: req.Item._id, isDeleted: false };
    if (cursor) query._id = { $gt: cursor };

    let items = await Directory.find(query)
      .populate("path", "_id name")
      .populate("userId", "_id name email avatarUrl")
      .sort({ _id: 1 })
      .limit(limit)
      .lean();

    const pr = items.map(async (item) => {
      item.filesCount = await UserFile.countDocuments({
        parentId: item._id,
        isDeleted: false,
      });
      item.dirsCount = await Directory.countDocuments({
        parentId: item._id,
        isDeleted: false,
      });
    });
    await Promise.all(pr);

    const nextCursor =
      items.length < limit ? null : items[items.length - 1]._id;

    const itemDocs = items.map((i) => getFileDoc(i));

    return res
      .status(200)
      .json({ success: true, data: { items: itemDocs, nextCursor } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/all-files/:id
 * what it do: Return all files directly under the given directory id if access allowed.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getAllFilesHandler = async (req, res, next) => {
  const lim = parseInt(req.query?.limit);
  const limit = lim > 0 && lim <= 100 ? lim : 50;

  const cursor = req.query?.cursor;
  if (cursor && !mongoose.isValidObjectId(cursor))
    return next(getErrorObject("Invalid id."));

  try {
    const query = { parentId: req.Item._id, isDeleted: false };
    if (cursor) query._id = { $gt: cursor };

    let items = await UserFile.find(query)
      .populate("userId", "_id name email avatarUrl")
      .populate("path", "_id name")
      .sort({ _id: 1 })
      .limit(limit)
      .lean();
    const nextCursor =
      items.length < limit ? null : items[items.length - 1]._id;

    const itemDocs = items.map((f) => getFileDoc(f));

    return res
      .status(200)
      .json({ success: true, data: { items: itemDocs, nextCursor } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/download/:id
 * what it do: Stream a ZIP of the directory contents if requester has access.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.user: authenticated user object provided by `validateSession`
 */
// export const downloadDirectoryHandler = async (req, res, next) => {
//   try {
//     const safeDirname = sanitizeName(req.Item.name);
//     const safeTimeStamp = new Date().toISOString().replace(/[-:.]/g, "");

//     const zipName = `${safeDirname}-${safeTimeStamp}.zip`;
//     // const zipPath = path.join(process.cwd(),"uploads", "temp", zipName);
//     // const output = createWriteStream(zipPath);

//     res.writeHead(200, {
//       "Content-Type": "application/zip",
//       "Content-Disposition": `attachment; filename="${zipName}"`,
//       "X-Content-Type-Options": "nosniff",
//     });

//     // Create ZIP stream
//     const archive = archiver("zip", {
//       zlib: { level: 2 },
//     });

//     // If client aborts, stop everything
//     req.on("close", () => {
//       // console.info("Client closed download.");
//       archive.abort();
//     });

//     req.on("aborted", () => {
//       // console.info("Client aborted download.");
//       archive.abort();
//     });

//     req.on("finish", () => console.info("Zip served successfully."));

//     archive.on("error", (err) => {
//       archive.abort();
//       next(err);
//     });

//     // archive.pipe(output);
//     // console.info("Zip creating started");

//     await archive.pipe(res);
//     console.info("Zip serving started");

//     // Traverse Directory tree and add files
//     const visited = new Set();

//     await serveZip({
//       archive,
//       dirId: req.Item._id,
//       zipPath: `${safeDirname}/`,
//       visited,
//     });

//     // Finalize ZIP
//     await archive.finalize();
//   } catch (err) {
//     if (res.headersSent) {
//       console.error("Stream failed mid-download:", err.message);
//       res.end();
//     } else {
//       next(err);
//     }
//   }
// };

export const downloadDirectoryInfoHandler = async (req, res, next) => {
  try {
    const dir = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("name _id")
      .lean();

    if (!dir) return next(getErrorObject("Directory not found.", 404));

    const totalSize = await calculateDirectorySize(dir._id);

    return res.status(200).json({
      success: true,
      data: {
        name: dir.name,
        size: totalSize,
      },
    });
  } catch (err) {
    next(err);
  }
};

const calculateDirectorySize = async (
  dirId,
  visited = new Set(),
  depth = 0,
) => {
  const MAX_DEPTH = process.env.MAX_DEPTH || 5;
  const dirIdStr = dirId.toString();
  if (visited.has(dirIdStr)) return 0;
  if (depth > MAX_DEPTH) return 0;
  visited.add(dirIdStr);

  let totalSize = 0;

  const files = await UserFile.find({ parentId: dirId, isDeleted: false })
    .select("size")
    .lean();

  for (const file of files) {
    totalSize += file.size || 0;
  }

  const subdirs = await Directory.find({ parentId: dirId, isDeleted: false })
    .select("_id")
    .lean();

  for (const subdir of subdirs) {
    totalSize += await calculateDirectorySize(subdir._id, visited, depth + 1);
  }

  return totalSize;
};

export const downloadDirectoryHandler = async (req, res, next) => {
  try {
    const owner = req.itemOwner || req.user;

    await ensureBandwidthWindow(owner);

    const usedBandwidth = owner.usedBandwidthQuota || 0;
    const bandwidthLimit =
      owner?.subscription?.limits?.monthlyBandwidthLimit ||
      PLAN_DETAILS[owner.plan]?.monthlyBandwidthLimit ||
      0;

    if (usedBandwidth >= bandwidthLimit) {
      return next(
        getErrorObject(
          "Bandwidth limit exceeded. Please upgrade your plan.",
          403,
        ),
      );
    }

    const activeKey = `download:active:${owner._id.toString()}`;
    const activeCount = await redisClient.incr(activeKey);
    if (activeCount > MAX_CONCURRENT_DOWNLOADS) {
      await redisClient.decr(activeKey);
      return next(
        getErrorObject("Too many concurrent downloads. Please wait.", 429),
      );
    }
    await redisClient.expire(activeKey, 300);

    const decrActive = () => {
      redisClient.decr(activeKey).catch(console.error);
    };

    const safeDirname = sanitizeName(req.Item.name);
    const safeTimeStamp = new Date().toISOString().replace(/[-:.]/g, "");

    const zipName = `${safeDirname}-${safeTimeStamp}.zip`;

    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "X-Content-Type-Options": "nosniff",
    });

    const archive = archiver("zip", {
      zlib: { level: 2 },
    });

    let totalBytes = 0;
    const byteCounter = new Transform({
      transform(chunk, encoding, callback) {
        totalBytes += chunk.length;
        callback(null, chunk);
      },
    });

    req.on("close", () => {
      decrActive();
      archive.abort();
    });

    req.on("aborted", () => {
      decrActive();
      archive.abort();
    });

    archive.on("error", (err) => {
      decrActive();
      archive.abort();
      next(err);
    });

    archive.pipe(byteCounter).pipe(res);
    console.info("Zip serving started");

    const visited = new Set();

    await serveZipS3({
      archive,
      dirId: req.Item._id,
      zipPath: `${safeDirname}/`,
      visited,
    });

    await archive.finalize();
    byteCounter.end();

    if (totalBytes > 0) {
      await User.findByIdAndUpdate(owner._id, {
        $inc: { usedBandwidthQuota: totalBytes },
      });
      redisClient
        .del(`storageApp:user:${owner._id.toString()}:userdata`)
        .catch(console.error);
    }

    decrActive();
  } catch (err) {
    decrActive();
    if (res.headersSent) {
      console.error("Stream failed mid-download:", err.message);
      res.end();
    } else {
      next(err);
    }
  }
};

/**
 * path: /api/directories/new
 * what it do: Create a new directory under the provided `targetId` if user has editor/owner access to the target.
 * requirements:
 *   - req.body: { targetId: string, name?: string }
 *   - req.user: authenticated user object provided by `validateSession`
 *   - `targetId` must be a valid directory id and user must have create permissions on it
 */
export const createDirectoryHandler = async (req, res, next) => {
  try {
    const { success, data, error } = filenameSchema.safeParse(req.body);
    if (!success) return next(getErrorObject(error.issues[0].message));

    const session = await mongoose.startSession();
    let newDir = null;
    const parent = req.parent;
    try {
      await session.withTransaction(async () => {
        const existingDirs = await Directory.find({
          name: data.name,
          userId: req.user._id,
        })
          .select("_id")
          .lean();
        if (existingDirs.length > 0) return null;

        [newDir] = await Directory.create(
          [
            {
              name: data.name,
              parentId: parent._id,
              path: parent.path,
              userId: parent.userId._id,
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    if (!newDir)
      return next(getErrorObject("Directory with same name already exists."));

    newDir.filesCount = 0;
    newDir.dirsCount = 0;
    newDir.userId = req.parent.userId;

    logActivity({
      userId: req.user._id,
      action: "create_directory",
      itemType: "directory",
      itemId: newDir._id,
      parentId: newDir.parentId,
      itemName: newDir.name,
    });

    return res.status(201).json({
      success: true,
      message: "Directory created.",
      data: { item: getFileDoc(newDir) },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/delete/:id
 * what it do: Permanently delete a directory and its contents (irreversible). only the directory owner may perform this action.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - restrictRootOperations middleware may apply; ensure requester has permissions
 */
export const deleteDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));
  try {
    const session = await mongoose.startSession();
    const s3KeysToDelete = [];
    let directoryName, directoryParentId;

    try {
      await session.withTransaction(async () => {
        const directory = await Directory.findOneAndDelete({
          _id: req.params.id,
          userId: req.user._id,
        })
          .select("_id name parentId")
          .session(session)
          .lean();

        if (!directory) throw getErrorObject("Directory not found.", 404);

        directoryName = directory.name;
        directoryParentId = directory.parentId;

        await recursiveDelete(directory._id, session, s3KeysToDelete);
      });
    } finally {
      await session.endSession();
    }

    if (s3KeysToDelete.length > 0) {
      try {
        await deleteS3Objects(s3KeysToDelete);
      } catch (err) {
        console.error("Failed to delete S3 objects:", err);
      }
    }

    const userKey = `storageApp:user:${req.user._id}:userdata`;
    await redisClient.del(userKey);

    logActivity({
      userId: req.user._id,
      action: "delete",
      itemType: "directory",
      itemId: req.params.id,
      parentId: directoryParentId || undefined,
      itemName: directoryName,
    });

    return res.status(200).json({
      success: true,
      message: "Directory permanently deleted and no longer available.",
      data: { id: req.params.id },
    });
  } catch (err) {
    next(err);
  }
};
