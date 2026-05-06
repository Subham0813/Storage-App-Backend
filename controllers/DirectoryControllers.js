import archiver from "archiver";
import mongoose from "mongoose";

import { recursiveDelete } from "../utils/remove.js";
import { serveZip, sanitizeName } from "../utils/serve.js";
import { getErrorObject } from "../utils/helper.js";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { filenameSchema } from "../Schemas/userSchema.js";
import { deleteS3Objects } from "../configs/s3Client.js";

/**
 * path: /api/directories/:id
 * what it do: List child directories of the given parent directory id if access allowed.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getDirectoriesHandler = async (req, res, next) => {
  let limit = parseInt(req.query.limit);
  limit = !limit || limit > 100 ? 50 : limit;

  const cursor = req.query.cursor;
  if (cursor && !mongoose.isValidObjectId(cursor))
    return next(getErrorObject("Invalid id."));

  try {
    const query = { parentId: req.Item._id, isDeleted: false };
    if (cursor) query._id = { $gt: cursor };

    const items = await Directory.find(query)
      .select("-__v -deletedBy -deletedAt -publicRole")
      .populate("ancestors", "_id name")
      .limit(limit)
      .lean();

    const nextCursor =
      items.length < limit ? null : items[items.length - 1]._id;

    return res.status(200).json({ success: true, data: { items, nextCursor } });
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
  let limit = parseInt(req.query.limit);
  limit = !limit || limit > 100 ? 50 : limit;

  const cursor = req.query.cursor;
  if (cursor && !mongoose.isValidObjectId(cursor))
    return next(getErrorObject("Invalid id."));

  try {
    const query = { parentId: req.Item._id, isDeleted: false };
    if (cursor) query._id = { $gt: cursor };

    const items = await UserFile.find(query)
      .select("-__v -key -webViewLink -deletedBy -deletedAt -publicRole")
      .populate("ancestors", "_id name")
      .limit(limit)
      .lean();

    const nextCursor =
      items.length < limit ? null : items[items.length - 1]._id;

    return res.status(200).json({ success: true, data: { items, nextCursor } });
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
export const downloadDirectoryHandler = async (req, res, next) => {
  try {
    const safeDirname = sanitizeName(req.Item.name);
    const safeTimeStamp = new Date().toISOString().replace(/[-:.]/g, "");

    // const zipName = `${safeDirname}-${new Date().toJSON()}-${dir.filesCount}-001.zip`; //google drive naming

    const zipName = `${safeDirname}-${safeTimeStamp}.zip`;
    // const zipPath = path.join(process.cwd(),"uploads", "temp", zipName);
    // const output = createWriteStream(zipPath);

    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "X-Content-Type-Options": "nosniff",
    });

    // Create ZIP stream
    const archive = archiver("zip", {
      zlib: { level: 2 },
    });

    // If client aborts, stop everything
    req.on("close", () => {
      // console.info("Client closed download.");
      archive.abort();
    });

    req.on("aborted", () => {
      // console.info("Client aborted download.");
      archive.abort();
    });

    req.on("finish", () => console.info("Zip served successfully."));

    archive.on("error", (err) => {
      archive.abort();
      next(err);
    });

    // archive.pipe(output);
    // console.info("Zip creating started");

    await archive.pipe(res);
    console.info("Zip serving started");

    // Traverse Directory tree and add files
    const visited = new Set();

    await serveZip({
      archive,
      dirId: req.Item._id,
      zipPath: `${safeDirname}/`,
      visited,
    });

    // Finalize ZIP
    await archive.finalize();
  } catch (err) {
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
        [newDir] = await Directory.create(
          [
            {
              name: data.name,
              parentId: parent._id,
              ancestors: parent.ancestors,
              userId: parent.userId,
            },
          ],
          { session },
        );

        // console.log(newDir);

        // await Directory.updateOne(
        //   { _id: tid },
        //   { $inc: { totalDirs: 1 } },
        //   { session },
        // );
      });
    } finally {
      await session.endSession();
    }

    return res.status(201).json({
      success: true,
      message: "Directory created.",
      data: {
        item: {
          _id: newDir._id,
          name: newDir.name,
          parentId: newDir.parentId,
          userId: newDir.userId,
          ancestors: newDir.ancestors,
          createdAt: newDir.createdAt,
          updatedAt: newDir.updatedAt,
          isDeleted: false,
          isStarred: false,
          // filesCount: 0,
          // dirsCount: 0,
        },
      },
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

    try {
      await session.withTransaction(async () => {
        const directory = await Directory.findOneAndDelete({
          _id: req.params.id,
          userId: req.user._id,
        })
          .select("_id")
          .session(session)
          .lean();

        if (!directory) throw getErrorObject("Directory not found.", 404);

        await recursiveDelete(directory._id, session, s3KeysToDelete);
      });
    } finally {
      await session.endSession();
    }

    if (s3KeysToDelete.length > 0) {
      deleteS3Objects(s3KeysToDelete).catch((err) =>
        console.error("Failed to delete S3 objects:", err),
      );
    }

    return res.status(200).json({
      success: true,
      message: "Directory permanently deleted and no longer available.",
      data: { item: { _id: req.params.id } },
    });
  } catch (err) {
    next(err);
  }
};
