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
import { isDescendent, hasAccess, getErrorObject } from "../utils/helper.js";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { shareDirectoryRecursive } from "../utils/share.js";
import { base64URLEncode } from "./oauthControllers.js";
import { SUPER_ROLES } from "../misc/constants.js";
import { filenameSchema } from "../Schemas/userSchema.js";

// API Handlers
/**
 * path: /api/directories/info/:id
 * what it do: Return metadata for a single directory if the requester is owner, shared user, or directory is public.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated user object ({ _id, email }) provided by `validateSession` middleware
 */
export const getDirectoryInfoHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id"));
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

    if (!directory) return next(getErrorObject("Directory not found.", 404));

    if (!req.isTokenAuthorized) {
      const isOwner =
        directory.userId._id.toString() === req.user._id.toString();
      const isPublic = directory.publicRole === "view";
      const isShared = req.user.email
        ? hasAccess(directory, ["view", "edit"], req.user.email)
        : false;

      if (!isPublic && !isShared && !isOwner)
        return next(getErrorObject("You do not have this permission.", 403));
    }

    const { sharedWith, publicRole, userId, ...dirData } = directory;
    const owner = { name: userId.name, email: userId.email };
    return res.status(200).json({
      success: true,
      message: "Directory found.",
      data: { directory: { ...dirData, owner } },
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
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId publicRole sharedWith")
      .lean();

    if (!directory) return next(getErrorObject("Directory not found.", 404));

    if (!req.isTokenAuthorized) {
      const { _id: userId, email } = req.user;
      const isOwner = directory.userId.toString() === userId.toString();
      const isPublic = directory.publicRole === "view";
      const isShared = email
        ? hasAccess(directory, ["view", "edit"], email)
        : false;

      if (!isPublic && !isShared && !isOwner)
        return next(getErrorObject("You do not have this permission.", 403));
    }

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
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId publicRole sharedWith")
      .lean();

    if (!directory) return next(getErrorObject("Directory not found.", 404));

    if (!req.isTokenAuthorized) {
      const { _id: userId, email } = req.user;
      const isOwner = directory.userId.toString() === userId.toString();
      const isPublic = directory.publicRole === "view";
      const isShared = email
        ? hasAccess(directory, ["view", "edit"], email)
        : false;

      if (!isPublic && !isShared && !isOwner)
        return next(getErrorObject("You do not have this permission.", 403));
    }

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
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("name size userId publicRole sharedWith")
      .lean();

    if (!directory) return next(getErrorObject("Directory not found.", 404));

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = email ? hasAccess(directory, ["edit"], email) : false;

    if (!isShared && !isOwner)
      return next(getErrorObject("You do not have this permission.", 403));

    const safeDirname = sanitizeName(directory.name);
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
      dirId: directory._id,
      zipPath: `${safeDirname}/`,
      visited,
      userEmail: email,
      userId,
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
  const { success, data, error } = filenameSchema.safeParse(req.body);
  if (!success) return next(getErrorObject(error.issues[0].message));

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

        if (!targetDir)
          throw getErrorObject("Target directory not found.", 404);

        [newDir] = await Directory.create(
          [
            {
              name: name,
              parentId: targetDirId,
              userId,
              isDeleted: false,
              deletedBy: "none",
              deletedAt: null,
              publicRole,
              sharedWith,
              sharedAt:
                publicRole !== "none" || sharedWith.length > 0
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
          name: newDir.name,
          parentId: newDir.parentId,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/rename/:id
 * what it do: Rename a directory if requester is owner or has edit access.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { name: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const renameDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));
  try {
    const { success, data, error } = filenameSchema.safeParse(req.body);
    if (!success) return next(getErrorObject(error.issues[0].message));

    const { name } = data;
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId publicRole sharedWith")
      .lean();

    if (!directory) return next(getErrorObject("Directory not found.", 404));

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = email ? hasAccess(directory, ["edit"], email) : false;
    if (!isShared && !isOwner)
      return next(getErrorObject("You do not have this permission.", 403));

    const session = await mongoose.startSession();
    let updated = null;
    try {
      await session.withTransaction(async () => {
        updated = await Directory.findOneAndUpdate(
          { _id: directory._id, isDeleted: false },
          { name: name },
          { session, returnDocument: "after" },
        )
          .select("_id parentId name")
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
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  const {
    _id: targetDirId,
    userId: targetUserId,
    publicRole,
    sharedWith,
    shareToken,
  } = req.parent;

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId name sharedWith parentId size")
      .lean();

    if (!directory) {
      return next(getErrorObject("Directory not found.", 404));
    } else if (directory.parentId.toString() === targetDirId.toString()) {
      return next(
        getErrorObject("Directory is already exists at this destination.", 409),
      );
    } else if (directory._id.toString() === targetDirId.toString()) {
      return next(
        getErrorObject("Cannot move a directory inside itself.", 403),
      );
    }

    const isChild = await isDescendent(directory._id, targetDirId);
    if (isChild) {
      return next(getErrorObject("Directory can not be moved to child.", 403));
    }

    const { _id: userId, email } = req.user;
    const isOwner =
      directory.userId.toString() === userId.toString() &&
      targetUserId.toString() === userId.toString();
    const isShared = email
      ? hasAccess(directory, ["edit"], email) &&
        hasAccess(req.parent, ["edit"], email)
      : false;
    if (!isShared && !isOwner)
      return next(getErrorObject("You do not have this permission.", 403));

    const updateQuery = {
      sharedWith,
      publicRole,
      shareToken,
      sharedBy:
        publicRole !== "none" || sharedWith.length > 0 ? "process" : "none",
      sharedAt:
        publicRole !== "none" || sharedWith.length > 0 ? new Date() : null,
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
      message: "Directory moved to the target directory.",
      directory: {
        _id: directory._id,
        name: directory.name,
        parentId: targetDirId,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/trash/:id
 * what it do: Move a directory to the bin (soft-delete) if requester is owner or has edit access.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const moveToBinDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId parentId publicRole sharedWith")
      .lean();

    if (!directory) return next(getErrorObject("Directory not found.", 404));

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = email ? hasAccess(directory, ["edit"], email) : false;
    if (!isShared && !isOwner)
      return next(getErrorObject("You do not have this permission.", 403));

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Directory.updateOne(
          { _id: directory._id },
          {
            $set: {
              isDeleted: true,
              deletedAt: new Date(),
              deletedBy: "user",
            },
          },
          { session },
        );

        await recursiveRemove(directory._id, session, new Set());
      });
    } finally {
      await session.endSession();
    }

    res.status(200).json({
      success: true,
      message: "Directory moved to bin.",
      directory: {
        _id: directory._id,
        parentId: directory.parentId,
        isDeleted: true,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/restore/:id
 * what it do: Restore a previously soft-deleted directory if requester is owner or has edit access.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const restoreDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      deletedBy: "user",
    })
      .select("userId publicRole sharedWith parentId")
      .lean();
    if (!directory) return next(getErrorObject("Directory not found."));

    const parent = await Directory.findOne({
      _id: directory.parentId,
      isDeleted: false,
    })
      .select("_id")
      .lean();
    if (!parent) return next(getErrorObject("Restore parent first."));

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = hasAccess(directory, ["edit"], email);

    if (!isShared && !isOwner)
      return next(getErrorObject("You do not have this permission.", 403));

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Directory.updateOne(
          { _id: directory._id },
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
      directory: {
        _id: directory._id,
        parentId: directory.parentId,
        isDeleted: false,
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

        if (!directory) throw getErrorObject("Directory not found.", 404);

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
      message: "Directory permanently deleted and no longer available.",
      directory: { _id: req.params.id },
    });
  } catch (err) {
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
          throw getErrorObject("Directory not found", 404);
        } else if (directory.userId.toString() !== req.user._id.toString()) {
          throw getErrorObject("You do not have this permission.", 403);
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
        updated = await Directory.findByIdAndUpdate(
          directory._id,
          updateQuery,
          { session, returnDocument: "after" },
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
    //   // console.log("emails sent");
    // }

    return res.status(200).json({
      success: true,
      message: `Share permission changed for ${accepted.length} people. Share permission changed at a depth of ${depth}`,
      data: { sharedWith: updated.sharedWith, shareToken, depth, accepted },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/public-role/:id
 * what it do: Change the `publicRole` for a directory (make publicly viewable or revoke). Only the directory owner may perform this action.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { publicRole?: 'view'|'none' }
 *   - req.user: authenticated user object provided by `validateSession` (must be directory owner)
 */
export const directoryPublicRoleHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id"));

  const { publicRole } = req.body;
  const allowedPublicRoles = ["view", "none"];

  const formattedPublicRole = publicRole
    ? String(publicRole).toUpperCase()
    : undefined;
  if (!formattedPublicRole || !allowedPublicRoles.includes(formattedPublicRole))
    return next(getErrorObject("Invalid payload"));

  const updateQuery = { $set: { publicRole: formattedPublicRole } };
  const session = await mongoose.startSession();
  let shareToken = null;
  try {
    await session.withTransaction(async () => {
      const directory = await Directory.findOne({
        _id: req.params.id,
        isDeleted: false,
      })
        .select("_id userId publicRole shareToken")
        .session(session)
        .lean();

      if (!directory) {
        throw getErrorObject("Directory not found.", 404);
      } else if (directory.userId.toString() !== req.user._id.toString()) {
        throw getErrorObject("You do not have this permission.", 403);
      }

      if (formattedPublicRole !== "none") {
        if (!directory.shareToken) {
          shareToken = base64URLEncode(crypto.randomBytes(32));
          updateQuery.$set.shareToken = shareToken;
          updateQuery.$set.sharedAt = new Date();
        } else shareToken = directory.shareToken;
      }

      updateQuery.$set.sharedBy = "user";
      await Directory.updateOne({ _id: directory._id }, updateQuery, {
        session,
      });

      updateQuery.$set.sharedBy = "process";
      await shareDirectoryRecursive(directory._id, session, [], updateQuery);
    });

    return res.status(201).json({
      success: true,
      message: "Public permission changed.",
      data: { publicRole: formattedPublicRole, token: shareToken },
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
export const createShareToken = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

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
        { session, returnDocument: "after" },
      )
        .select("_id")
        .lean();

      if (!dir)
        throw getErrorObject("Directory not exists or non-shared.", 404);

      await shareDirectoryRecursive(dir._id, session, [], {
        $set: { shareToken },
      });
    });

    return res.status(201).json({
      success: true,
      message: "New token created.",
      data: { newToken: shareToken },
    });
  } catch (err) {
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
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

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

    if (!directory) return next(getErrorObject("Shared directory not found."));

    const session = await mongoose.startSession();
    let depth = 0;
    let updated = null;
    try {
      await session.withTransaction(async () => {
        updated = await Directory.findOneAndUpdate(
          { _id: req.params.id, userId: req.user._id, isDeleted: false },
          updateQuery,
          { returnDocument: "after", session },
        )
          .select("_id sharedWith publicRole")
          .lean();

        let emailsToPull = emailsToUpdate;
        if (updated.sharedWith.length < 1 && updated.publicRole === "none") {
          updateQuery = {
            $set: {
              sharedBy: "none",
              sharedWith: [],
              publicRole: "none",
              sharedAt: null,
              shareToken: null,
            },
          };

          updated = await Directory.findByIdAndUpdate(
            updated._id,
            updateQuery,
            { session, returnDocument: "after" },
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
      message: `Share permission revoked for ${emailsToUpdate.length} people. Permission revoked at a depth of ${depth}`,
      data: {
        sharedWith: updated.sharedWith,
        publicRole: updated.pubicRole,
        depth,
        revoked: emailsToUpdate,
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
    return next(getErrorObject("Invalid id."));

  const { starred } = req.body;
  if (typeof starred !== "boolean")
    return next(getErrorObject("Invalid payload."));
  try {
    const directory = await Directory.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: false,
        isStarred: !starred,
      },
      { $set: { isStarred: starred } },
      { returnDocument: "after" },
    )
      .select("_id")
      .lean();
    if (!directory)
      return next(
        getErrorObject(
          `${starred ? "Starred" : "Non-starred"} directory not found.`,
        ),
      );

    return res.status(200).json({
      success: true,
      message: "Properties changed.",
      data: { directory },
    });
  } catch (err) {
    next(err);
  }
};
