import path from "path";
import archiver from "archiver";
import mongoose from "mongoose";
import { unlink } from "fs/promises";
import crypto from "crypto";

import { recursiveDelete, recursiveRemove } from "../utils/remove.js";
import {
  restoreChildDirectories,
  restoreChildFiles,
} from "../utils/restore.js";
import { serveZip, sanitizeName } from "../utils/serve.js";
import { isDescendent, hasAccess, responsePayload } from "../utils/helper.js";
import { badRequest, forbidden, notFound } from "../utils/helper.js";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { shareDirectoryRecursive } from "../utils/share.js";
import { base64URLEncode } from "./oauthControllers.js";
import { SUPER_ROLES } from "../misc/constants.js";
import { filenameSchema } from "../Schemas/userSchema.js";
import { emailSchema } from "../Schemas/authSchema.js";

// API Handlers
/**
 * path: /api/directories/info/:id
 * what it do: Return metadata for a single directory if the requester is owner, shared user, or directory is public.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated user object ({ _id, email }) provided by `validateSession` middleware
 */
export const getDirectoryInfoHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }
  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      deletedBy: { $ne: "process" },
    })
      .select(
        "-__v -sharedBy -deletedBy -deletedAt -shareToken -sharedAt -isDeleted",
      )
      .populate("userId", "name email avatar")
      .lean();

    if (!directory) return notFound(res, "Directory not found!");

    const isOwner = directory.userId._id.toString() === req.user._id.toString();
    const isPublic = directory.publicRole === "VIEWER";
    const isShared = req.user.email
      ? hasAccess(directory, ["VIEWER", "EDITOR"], req.user.email)
      : false;

    if (
      !isPublic &&
      !isShared &&
      !isOwner &&
      !req.isTokenAuthorized &&
      !SUPER_ROLES.includes(req.user.role)
    )
      return forbidden(res);

    const { sharedWith, publicRole, userId, ...dirData } = directory;
    const owner = { name: userId.name, email: userId.email };
    return res.status(200).json({
      success: true,
      message: "Directory found.",
      data: { directory: {...dirData, owner} },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/:id
 * what it do: List child directories of the given parent directory id if access allowed.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getDirectoriesHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId publicRole sharedWith")
      .lean();

    if (!directory) return notFound(res, "Directory not found!");

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isPublic = directory.publicRole === "VIEWER";
    const isShared = email
      ? hasAccess(directory, ["VIEWER", "EDITOR"], email)
      : false;

    if (
      !isPublic &&
      !isShared &&
      !isOwner &&
      !req.isTokenAuthorized &&
      !SUPER_ROLES.includes(req.user.role)
    )
      return forbidden(res);

    const directories = await Directory.find(
      {
        parentId: req.params.id,
        isDeleted: false,
      },
      "-__v -sharedBy -deletedBy -deletedAt -shareToken -sharedAt -sharedWith -publicRole -isDeleted",
    ).lean();

    return res.status(200).json({
      success: true,
      message: "Directories found.",
      data: { directories },
    });
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
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId publicRole sharedWith")
      .lean();

    if (!directory) return notFound(res, "Directory not found!");

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isPublic = directory.publicRole === "VIEWER";
    const isShared = email
      ? hasAccess(directory, ["VIEWER", "EDITOR"], email)
      : false;

    if (
      !isPublic &&
      !isShared &&
      !isOwner &&
      !req.isTokenAuthorized &&
      !SUPER_ROLES.includes(req.user.role)
    )
      return forbidden(res);

    const files = await UserFile.find(
      {
        parentId: directory._id,
        isDeleted: false,
      },
      "-__v -sharedBy -deletedBy -deletedAt -shareToken -sharedAt -sharedWith -publicRole -meta -isDeleted",
    ).lean();

    return res
      .status(200)
      .json({ success: true, message: "Files found.", data: { files } });
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
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId publicRole sharedWith")
      .lean();

    if (!directory) return notFound(res, "Directory not found!");

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = email ? hasAccess(directory, ["EDITOR"], email) : false;

    if (!isShared && !isOwner) return forbidden(res);

    const safeDirname = sanitizeName(directory.dirname);
    const safeTimeStamp = new Date().toISOString().replace(/[-:.]/g, "");

    // const zipName = `${dir.name}-${new Date().toJSON()}-${dir.filesCount}-001.zip`; //google drive naming

    const zipName = `${safeDirname}-${safeTimeStamp}-001.zip`;
    // const zipPath = path.join(process.cwd(),"uploads", "temp", zipName);
    // const output = createWriteStream(zipPath);

    res.writeHead(200, {
      "Content-Length": directory.size,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "X-Content-Type-Options": "nosniff",
    });

    // Create ZIP stream
    const archive = archiver("zip", {
      zlib: { level: 2 }, // fast compression
    });

    // If client aborts, stop everything
    req.on("close", () => {
      console.log("Client aborted download!!");
      archive.abort();
    });

    req.on("aborted", () => {
      console.log("Client aborted download!!");
      archive.abort();
    });

    req.on("end", () => console.log("Zip served successfully."));

    archive.on("error", (err) => {
      archive.abort();
      next(err);
    });

    // archive.pipe(output);
    // console.log("Zip creating started..");

    archive.pipe(res);
    console.log("Zip serving started..");

    // Traverse Directory tree and add files
    const visited = new Set();

    await serveZip({
      archive,
      dirId: directory._id,
      zipPath: `${directory.dirname}/`,
      visited,
      userEmail: email,
      userId,
    });

    // Finalize ZIP
    await archive.finalize();
    res.status(200).end();
  } catch (err) {
    next(err);
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
  const { success, data, error } = filenameSchema.safeParse(req.body);
  if (!success) return badRequest(res, error.issues[0].message);

  const { name } = data;
  const { _id: targetDirId, userId, publicRole, sharedWith } = req.parent;

  try {
    const session = await mongoose.startSession();
    let newDir = null;

    try {
      await session.withTransaction(async () => {
        const targetDir = await Directory.findOne({
          _id: targetDirId,
          isDeleted: false,
        })
          .session(session)
          .select("_id")
          .lean();

        if (!targetDir) {
          const error = new Error("Target directory not found.");
          error.statusCode = 404;
          throw error;
        }
        [newDir] = await Directory.create(
          [
            {
              dirname: name,
              parentId: targetDirId,
              userId,
              isDeleted: false,
              deletedBy: "none",
              deletedAt: null,
              publicRole,
              sharedWith,
              sharedAt:
                publicRole !== "NONE" || sharedWith.length > 0
                  ? new Date()
                  : null,
            },
          ],
          { session },
        );

        // console.log(newDir);

        // await Directory.updateOne(
        //   { _id: targetDirId },
        //   { $inc: { totalDirs: 1 } },
        //   { session },
        // );
      });
    } finally {
      if (session) await session.endSession();
    }

    return res.status(201).json({
      success: true,
      message: "Directory created.",
      data: {
        directory: {
          _id: newDir._id,
          dirname: newDir.dirname,
          parentId: newDir.parentId,
        },
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return responsePayload(res, err.statusCode, err.message);
    }
    next(err);
  }
};

/**
 * path: /api/directories/rename/:id
 * what it do: Rename a directory if requester is owner or has EDITOR access.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { name: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const renameDirectoryHandler = async (req, res, next) => {
  try {
    const { success, data, error } = filenameSchema.safeParse(req.body);
    if (!success) return badRequest(res, error.issues[0].message);

    const { name } = data;
    if (!mongoose.isValidObjectId(req.params.id))
      return badRequest(res, "Invalid id.");

    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId publicRole sharedWith")
      .lean();

    if (!directory) return notFound(res, "Directory not found!");

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = email ? hasAccess(directory, ["EDITOR"], email) : false;
    if (!isShared && !isOwner) return forbidden(res);

    const session = await mongoose.startSession();
    let updated = null;
    try {
      await session.withTransaction(async () => {
        updated = await Directory.findOneAndUpdate(
          { _id: directory._id, isDeleted: false },
          { dirname: name },
          { session, new: true },
        )
          .select("_id parentId dirname")
          .lean();
      });
    } finally {
      await session.endSession();
    }

    return res.status(200).json({
      success: true,
      message: "Directory renamed.",
      data: { directory: updated },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/move/:id
 * what it do: Move a directory to a different parent if user has appropriate permissions on both source and target.
 * requirements:
 *   - req.params: { id: string } (directory id to move)
 *   - req.body: { targetId: string } (destination directory id)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const moveDirectoryHandler = async (req, res, next) => {
  const {
    _id: targetDirId,
    userId: targetUserId,
    publicRole,
    sharedWith,
    shareToken,
  } = req.parent;
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId dirname sharedWith parentId size")
      .lean();

    if (!directory) return notFound(res, "Directory not found!");
    else if (directory.parentId.toString() === targetDirId.toString()) {
      return badRequest(res, "Directory is already in this destination.");
    } else if (directory._id.toString() === targetDirId.toString()) {
      return badRequest(res, "Cannot move a directory inside itself.");
    }

    const isChild = await isDescendent(directory._id, targetDirId);
    if (isChild) {
      return badRequest(res, "Directory can not be moved to child.");
    }

    const { _id: userId, email } = req.user;
    const isOwner =
      directory.userId.toString() === userId.toString() &&
      targetUserId.toString() === userId.toString();
    const isShared = email
      ? hasAccess(directory, ["EDITOR"], email) &&
        hasAccess(req.parent, ["EDITOR"], email)
      : false;
    if (!isShared && !isOwner) return forbidden(res);

    const updateQuery = {
      sharedWith,
      publicRole,
      shareToken,
      sharedBy:
        publicRole !== "NONE" || sharedWith.length > 0 ? "process" : "none",
      sharedAt:
        publicRole !== "NONE" || sharedWith.length > 0 ? new Date() : null,
    };
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await Directory.updateOne(
          { _id: directory._id },
          { $set: { parentId: targetDirId, ...updateQuery } },
          { session },
        );
        await Directory.updateOne(
          { _id: targetDirId },
          { $inc: { size: directory.size } },
          { session },
        );
        await Directory.updateOne(
          { _id: directory.parentId },
          { $inc: { size: -directory.size } },
          { session },
        );

        await shareDirectoryRecursive(directory._id, session, [], {
          $set: { ...updateQuery },
        });
      });
    } finally {
      await session.endSession();
    }

    return res.status(200).json({
      success: true,
      message: "Directory moved.",
      data: {
        directory: {
          _id: directory._id,
          dirname: directory.dirname,
          parentId: targetDirId,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/trash/:id
 * what it do: Move a directory to the bin (soft-delete) if requester is owner or has EDITOR access.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const moveToBinDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId parentId publicRole sharedWith")
      .lean();

    if (!directory) return notFound(res, "Directory not found!");

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = email ? hasAccess(directory, ["EDITOR"], email) : false;
    if (!isShared && !isOwner) return forbidden(res);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Directory.findByIdAndUpdate(directory._id, {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: "user",
          },
        });

        await recursiveRemove(directory._id, session, new Set());
      });
    } finally {
      await session.endSession();
    }

    res.status(200).json({
      success: true,
      message: "Directory moved to bin.",
      data: {
        directory: {
          _id: directory._id,
          parentId: directory.parentId,
          isDeleted: true,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/restore/:id
 * what it do: Restore a previously soft-deleted directory if requester is owner or has EDITOR access.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const restoreDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      deletedBy: "user",
    })
      .select("userId publicRole sharedWith parentId")
      .lean();
    if (!directory) return badRequest(res, "Directory not found!");

    const parent = await Directory.findOne({
      _id: directory.parentId,
      isDeleted: false,
    })
      .select("_id")
      .lean();
    if (!parent) return badRequest(res, "Restore parent first.");

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = hasAccess(directory, ["EDITOR"], email);

    if (!isShared && !isOwner) return forbidden(res);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Directory.findByIdAndUpdate(
          directory._id,
          {
            $set: {
              isDeleted: false,
              deletedBy: "none",
              deletedAt: null,
            },
          },
          { session },
        );

        await restoreChildFiles(directory._id, session);
        await restoreChildDirectories(directory._id, session);
      });
    } finally {
      await session.endSession();
    }

    return res.status(200).json({
      success: true,
      message: "Directory restored.",
      data: {
        directory: {
          _id: directory._id,
          parentId: directory.parentId,
          isDeleted: false,
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
    return badRequest(res, "Invalid id.");

  try {
    const session = await mongoose.startSession();
    const filesToDelete = [];

    try {
      await session.withTransaction(async () => {
        const directory = await Directory.findOneAndDelete({
          _id: req.params.id,
          userId: req.user._id,
        })
          .select("_id")
          .session(session)
          .lean();

        if (!directory) {
          const error = new Error("Directory not found.");
          error.statusCode = 404;
          throw error;
        }

        const visited = new Set();
        await recursiveDelete(
          directory._id,
          visited,
          session,
          filesToDelete,
          req.user._id,
        );
      });
    } finally {
      await session.endSession();
    }

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

    return res.status(200).json({
      success: true,
      message: "Directory permanently deleted.",
      data: { directory: { _id: req.params.id } },
    });
  } catch (err) {
    if (err.statusCode)
      return responsePayload(res, err.statusCode, err.message);
    next(err);
  }
};

/**
 * path: /api/directories/share/:id
 * what it do: Change sharing settings for a directory — set `publicRole` and add/update `sharedWith` entries; only the directory owner may perform this action.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { emailsWithRole?: [{ email, role }], notify?: boolean, message?: string }
 *   - req.user: authenticated user object provided by `validateSession` (must be directory owner)
 *   - When used with `shareHandlerPreProcessor` middleware, expects `req.shareConfig` and responds with `{ accepted, shareToken }`
 */
export const shareDirectoryHandler = async (req, res, next) => {
  const { notify, message } = req.body;
  const { updateQuery, emailsToUpdate, accepted } = req.shareConfig;

  const session = await mongoose.startSession();
  let shareToken = null;
  let depth = 0;
  let updated = null;
  try {
    try {
      await session.withTransaction(async () => {
        const directory = await Directory.findOne({
          _id: req.params.id,
          isDeleted: false,
        })
          .select("_id userId shareToken")
          .session(session)
          .lean();

        if (!directory) {
          const error = new Error("Directory not found.");
          error.statusCode = 404;
          throw error;
        }
        if (directory.userId.toString() !== req.user._id.toString()) {
          const error = new Error("You don't have this permission.");
          error.statusCode = 403;
          throw error;
        }
        if (!directory.shareToken) {
          shareToken = base64URLEncode(crypto.randomBytes(32));
          updateQuery.$set.shareToken = shareToken;
        } else shareToken = directory.shareToken;

        await Directory.updateOne(
          { _id: req.params.id, userId: req.user._id, isDeleted: false },
          { $pull: { sharedWith: { email: { $in: emailsToUpdate } } } },
          { session },
        );

        updateQuery.$set.sharedBy = "user";
        updated = await Directory.findOneAndUpdate(
          { _id: directory._id },
          updateQuery,
          { session, new: true },
        )
          .select("sharedWith publicRole -_id")
          .lean();

        updateQuery.$set.sharedBy = "process";
        depth = await shareDirectoryRecursive(
          directory._id,
          session,
          emailsToUpdate,
          updateQuery,
          depth,
        );
      });
    } finally {
      await session.endSession();
    }

    // if (notify) {
    //   //send notification to accepted emails
    //   // await sendEmails(accepted, message)
    //   // console.log("emails sent.");
    // }

    return res.status(200).json({
      success: true,
      message: "Permission changed.",
      data: {
        sharedWith: updated.sharedWith,
        depth,
        accepted,
        shareToken,
      },
    });
  } catch (err) {
    if (err.statusCode)
      return responsePayload(res, err.statusCode, err.message);
    next(err);
  }
};

/**
 * path: /api/directories/public-role/:id
 * what it do: Change the `publicRole` for a directory (make publicly viewable or revoke). Only the directory owner may perform this action.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { publicRole?: 'VIEWER'|'NONE' }
 *   - req.user: authenticated user object provided by `validateSession` (must be directory owner)
 */
export const directoryPublicRoleHandler = async (req, res, next) => {
  const { publicRole } = req.body;
  const allowedPublicRoles = ["VIEWER", "NONE"];

  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  const formattedPublicRole = publicRole
    ? String(publicRole).toUpperCase()
    : undefined;
  if (!formattedPublicRole || !allowedPublicRoles.includes(formattedPublicRole))
    return badRequest(res, "Invalid `publicRole`.");

  const updateQuery = { $set: { publicRole: formattedPublicRole } };
  const session = await mongoose.startSession();
  let shareToken = null;
  try {
    await session.withTransaction(async () => {
      const directory = await Directory.findOne({
        _id: req.params.id,
        isDeleted: false,
      })
        .select("_id userId shareToken")
        .session(session)
        .lean();

      if (!directory) {
        const error = new Error("Directory not found.");
        error.statusCode = 404;
        throw error;
      }
      if (directory.userId.toString() !== req.user._id.toString()) {
        const error = new Error("You don't have this permission.");
        error.statusCode = 403;
        throw error;
      }

      if (!directory.shareToken) {
        shareToken = base64URLEncode(crypto.randomBytes(32));
        updateQuery.$set.shareToken = shareToken;
        updateQuery.$set.sharedAt = new Date();
      } else shareToken = directory.shareToken;

      updateQuery.$set.sharedBy = "user";
      await Directory.findByIdAndUpdate(directory._id, updateQuery, {
        session,
      });

      updateQuery.$set.sharedBy = "process";
      await shareDirectoryRecursive(directory._id, session, [], updateQuery);
    });

    return res.status(200).json({
      success: true,
      message: "Permission changed.",
      data: { token: shareToken },
    });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
};

/**
 * path: /api/directories/new-token/:id
 * what it do: Generate a new `shareToken` for the directory and persist it (owner-only). Token is propagated to children as needed.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.user: authenticated user object provided by `validateSession` (must be directory owner)
 * returns:
 *   - { shareToken, id }
 */
export const getNewDirectoryShareToken = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  const shareToken = base64URLEncode(crypto.randomBytes(32));
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const dir = await Directory.findOneAndUpdate(
        {
          _id: req.params.id,
          userId: req.user._id,
          isDeleted: false,
          sharedBy: { $ne: "none" },
        },
        { $set: { shareToken, sharedBy: "user" } },
        { session, new: true },
      )
        .select("_id")
        .lean();
      if (!dir) {
        const error = new Error("Directory not exists or non-shared.");
        error.statusCode = 404;
        throw error;
      }

      await shareDirectoryRecursive(dir._id, session, [], {
        $set: { shareToken },
      });
    });

    return res.status(200).json({
      success: true,
      message: "Token created for the file.",
      data: { newToken: shareToken },
    });
  } catch (err) {
    if (err.statusCode)
      return responsePayload(res, err.statusCode, err.message);
    next(err);
  } finally {
    session.endSession();
  }
};

/**
 * path: /api/directories/revoke-access/:id
 * what it do: Remove sharing settings for a directory (set publicRole and pull individual sharedWith entries).
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { emails: [email : string] }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const revokeAccessDirectoryHandler = async (req, res, next) => {
  const { updateQuery, emailsToUpdate, formattedPublicRole } = req.revokeConfig;

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
      sharedBy: { $ne: "none" },
    })
      .select("_id sharedWith publicRole")
      .lean();

    if (!directory) return notFound(res, "directory not found.");
    if (directory.publicRole !== "VIEWER" && directory.sharedWith.length < 1)
      return responsePayload(
        res,
        403,
        "Cannot perform revoke on a non-shared item.",
      );

    const session = await mongoose.startSession();
    let depth = 0;
    let updated = null;
    try {
      await session.withTransaction(async () => {
        updated = await Directory.findOneAndUpdate(
          { _id: req.params.id, userId: req.user._id, isDeleted: false },
          updateQuery,
          { new: true, session },
        )
          .select("_id sharedWith publicRole")
          .lean();

        let emailsToPull = emailsToUpdate;
        if (updated.sharedWith.length < 1 && updated.publicRole === "NONE") {
          updateQuery = {
            $set: {
              sharedBy: "none",
              sharedWith: [],
              publicRole: "NONE",
              sharedAt: null,
              shareToken: null,
            },
          };

          updated = await Directory.findOneAndUpdate(
            { _id: updated._id },
            updateQuery,
            { session, new: true },
          )
            .select("_id sharedWith publicRole")
            .lean();
          emailsToPull = [];
        }

        depth = await shareDirectoryRecursive(
          updated._id,
          session,
          emailsToPull,
          updateQuery,
        );
      });
    } finally {
      await session.endSession();
    }

    return res.status(200).json({
      success: true,
      message: "Permission changed for this directory.",
      data: {
        sharedWith: updated.sharedWith,
        publicRole: updated.pubicRole,
        depth,
        revoked: emailsToUpdate,
        skipped,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/starred/:id
 * what it do: Mark file/s as starred/non-starred as per user request.
 * requirements:
 *   - req.params: { id: string } (file id)
 *   - req.body: { starred: boolean }
 *   - req.user: authenticated user object provided by `validateSession` (must be file owner)
 */
export const makeDirectoryStarred = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  const { starred } = req.body;
  if (typeof starred !== "boolean") return badRequest(res, "Invalid payload.");
  try {
    const dir = await Directory.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: false,
        isStarred: !starred,
      },
      { $set: { isStarred: starred } },
      { new: true },
    )
      .select("_id")
      .lean();
    if (!dir)
      return notFound(
        res,
        `Directory not found or already ${starred ? "starred" : "non-starred"}.`,
      );

    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};
