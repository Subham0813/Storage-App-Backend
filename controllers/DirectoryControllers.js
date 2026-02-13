import path from "path";
import archiver from "archiver";
import mongoose from "mongoose";
import { unlink } from "fs/promises";
import crypto from "node:crypto";

import { recursiveDelete, recursiveRemove } from "../utils/remove.js";
import {
  restoreChildDirectories,
  restoreChildFiles,
} from "../utils/restore.js";
import { serveZip, sanitizeName } from "../utils/serve.js";
import { isDescendent, hasAccess } from "../utils/helper.js";
import { badRequest, forbidden, notFound } from "../utils/helper.js";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { base64URLEncode } from "./oauthControllers.js";
import { shareDirectoryRecursive } from "../utils/share.js";

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

    if (!isPublic && !isShared && !isOwner && !req.isTokenAuthorized)
      return forbidden(res);

    return res.status(200).json({ success: true, data: { directory } });
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

    if (!isPublic && !isShared && !isOwner && !req.isTokenAuthorized)
      return forbidden(res);

    const directories = await Directory.find({
      parentId: req.params.id,
      isDeleted: false,
    });
    return res.status(200).json({ success: true, data: { directories } });
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

    if (!isPublic && !isShared && !isOwner && !req.isTokenAuthorized)
      return forbidden(res);

    const files = await UserFile.find({
      parentId: directory._id,
      isDeleted: false,
    });

    return res.status(200).json({ data: { files } });
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
  const { _id: targetDirId, userId, publicRole, sharedWith } = req.parent;

  const session = await mongoose.startSession();
  try {
    const directory = await session.withTransaction(async () => {
      const [newDir] = await Directory.create(
        [
          {
            dirname: req.body.name
              ? req.body.name.toString()
              : "Untitled Directory",
            parentId: targetDirId,
            userId,
            isDeleted: false,
            deletedBy: "none",
            deletedAt: null,
            publicRole,
            sharedWith,
            sharedAt: publicRole || sharedWith.length > 0 ? new Date() : null,
          },
        ],
        { session },
      );
      return newDir;
    });

    return res.status(201).json({
      success: true,
      message: "Directory created.",
      data: { directory },
    });
  } catch (err) {
    next(err);
  } finally {
    if (session) session.endSession();
  }
};

/**
 * path: /api/directories/rename/:id
 * what it do: Rename a directory if requester is owner or has EDITOR access.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { newname: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const renameDirectoryHandler = async (req, res, next) => {
  const { newname } = req.body;
  if (!newname)
    return badRequest(res, "Invalid payload. `newname` is required.");

  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

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

    const renamed = await Directory.findByIdAndUpdate(directory._id, {
      dirname: newname.toString(),
    }).lean();

    return res
      .status(200)
      .json({ success: true, message: "Directory renamed." });
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
  try {
    const directory = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).select("userId publicRole sharedWith");

    if (!directory) return notFound(res, "Directory not found!");

    const { _id: targetDirId } = req.parent;
    if (directory.parentId.toString() === targetDirId.toString()) {
      return badRequest(res, "Directory is already in this destination.");
    }

    if (directory._id.toString() === targetDirId.toString()) {
      return badRequest(res, "Cannot move a directory inside itself.");
    }

    const isChild = await isDescendent(directory._id, targetDirId);
    if (isChild) {
      return badRequest(res, "Directory can not be moved to child.");
    }

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = email ? hasAccess(directory, ["EDITOR"], email) : false;

    if (!isShared && !isOwner) return forbidden(res);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Directory.findByIdAndUpdate(
          targetDirId,
          { $inc: { size: directory.size } },
          { session },
        );

        await Directory.findByIdAndUpdate(
          directory._id,
          { $set: { parentId: targetDirId } },
          { session },
        );

        await Directory.findByIdAndUpdate(
          directory.parentId,
          { $inc: { size: -directory.size } },
          { session },
        );
      });
    } finally {
      session.endSession();
    }

    return res.status(200).json({
      success: true,
      message: "Directory moved.",
    });
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
    const isPublic = directory.publicRole === "VIEWER";
    const isShared = email
      ? hasAccess(directory, ["EDITOR", "VIEWER"], email)
      : false;

    if (!isShared && !isOwner && !isPublic) return forbidden(res);

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
    });

    // Finalize ZIP
    await archive.finalize();
    res.status(200).end();
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
    }).select("userId publicRole sharedWith");

    if (!directory) return notFound(res, "Directory not found!");

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = email ? hasAccess(directory, ["EDITOR"], email) : false;

    if (!isShared && !isOwner) return forbidden(res);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updatedDir = await Directory.findByIdAndUpdate(
          directory._id,
          {
            $set: {
              isDeleted: true,
              deletedAt: new Date(),
              deletedBy: "user",
            },
          },
          { new: true, session },
        );

        await recursiveRemove(directory._id, session, new Set());
      });
    } finally {
      session.endSession();
    }

    res.status(200).json({ success: true, message: "Directory moved to bin." });
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
    }).select("_id");

    if (!parent) {
      return badRequest(res, "Parent folder is deleted. Restore parent first.");
    }

    const { _id: userId, email } = req.user;
    const isOwner = directory.userId.toString() === userId.toString();
    const isShared = hasAccess(directory, ["EDITOR"], email);

    if (!isShared && !isOwner) return forbidden(res);

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const updatedDir = await Directory.findByIdAndUpdate(
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
      session.endSession();
    }

    return res
      .status(200)
      .json({ success: true, message: "Directory restored." });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/directories/delete/:id
 * what it do: Permanently delete a directory and its contents (irreversible).
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - restrictRootOperations middleware may apply; ensure requester has permissions
 */
export const deleteDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  const session = await mongoose.startSession();
  const filesToDelete = [];

  try {
    await session.withTransaction(async () => {
      const directory = await Directory.findOneAndDelete({
        _id: req.params.id,
        userId: req.user._id,
      })
        .select("_id")
        .session(session);

      const visited = new Set();
      await recursiveDelete(directory._id, visited, session, filesToDelete);
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

    return res.status(200).json({
      message: "Directory deletion successful and no longer available.",
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};

/**
 * path: /api/directories/share/:id
 * what it do: Change sharing settings for a directory (set publicRole and push individual sharedWith entries).
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { emailsWithRole?: [{ email, role }], publicRole?: string, notify?: boolean }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const shareDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  //emailsWithRole: [{email: "", role:""}], publicRole: "", notify: true
  const { emailsWithRole, publicRole, notify } = req.body;
  const allowedPublicRoles = ["VIEWER", "NONE"];
  const allowedUserRoles = ["VIEWER", "EDITOR"];
  const formattedPublicRole = publicRole ? publicRole.toUpperCase() : undefined;

  if (!emailsWithRole && !publicRole)
    return badRequest(res, "Invalid payload.");

  if (!formattedPublicRole || !allowedPublicRoles.includes(formattedPublicRole))
    return badRequest(res, "Invalid `publicRole`.");

  const skipped = [];
  const validMap = new Map();

  emailsWithRole &&
    emailsWithRole.forEach(({ email, role }) => {
      const ce = email.toLowerCase().trim();
      const cr = role.toUpperCase();

      if (
        !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ce) ||
        !allowedUserRoles.includes(cr)
      ) {
        skipped.push({
          email: ce,
          role: cr,
          reason: "Invalid `email` or `role`.",
        });
      } else validMap.set(ce, { email: ce, role: cr });
    });

  const shareToken = base64URLEncode(crypto.randomBytes(24)).toString(
    "base64url",
  );

  const validEntries = Array.from(validMap.values());
  const emailsToUpdate = validEntries.map((v) => v.email);

  const updateQuery = {
    $set: { sharedAt: new Date(), shareToken: shareToken },
  };
  if (formattedPublicRole) updateQuery.$set.publicRole = formattedPublicRole;
  if (validEntries.length > 0)
    updateQuery.$push = { sharedWith: { $each: validEntries } };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const directory = await Directory.findOne({
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: false,
      }).select("_id");

      if (emailsToUpdate.length > 0)
        await Directory.findByIdAndUpdate(
          directory._id,
          { $pull: { sharedWith: { email: { $in: emailsToUpdate } } } },
          { session },
        );

      await Directory.findByIdAndUpdate(directory._id, updateQuery, {
        session,
      });

      await shareDirectoryRecursive(
        directory._id,
        session,
        emailsToUpdate,
        updateQuery,
      );
    });

    res.status(200).json({
      success: true,
      message: "Permission changed for this directory.",
      depth: 5,
      accepted: validEntries,
      skipped,
      shareToken,
    });

    if (notify) {
      //send notification to accepted emails
      console.log("emails sent.");
    }
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
};
