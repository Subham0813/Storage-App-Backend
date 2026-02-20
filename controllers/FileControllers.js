import path from "node:path";
import { existsSync, createReadStream, statSync } from "node:fs";
import mongoose from "mongoose";
import { unlink } from "node:fs/promises";
import { getFileDoc, hasAccess } from "../utils/helper.js";

import { File as FileModel } from "../models/file.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import {
  responsePayload,
  badRequest,
  forbidden,
  notFound,
} from "../utils/helper.js";
import { SUPER_ROLES } from "./adminControllers.js";

//env variables
const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

//API Handlers

/**
 * path: /api/files/info/:id
 * what it do: Return metadata for a single file if requester is owner, shared user, or file is public.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getFileInfoHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).lean();

    if (!file) return badRequest(res, "File not found!");

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isPublic = file.publicRole === "VIEWER";
    const isShared = hasAccess(file, ["VIEWER", "EDITOR"], email);

    if (
      !isPublic &&
      !isShared &&
      !isOwner &&
      !req.isTokenAuthorized &&
      !SUPER_ROLES.includes(req.user.role)
    )
      return forbidden(res);

    return res
      .status(200)
      .json({ success: true, message: "file found.", data: { file } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/preview/:id
 * what it do: Stream an inline preview (audio/video) when allowed by file disposition and permissions.
 * requirements:
 *   - req.params: { id: string }
 *   - req.query or req.body: optional { type: 'video'|'audio', force?: 'true' }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const previewFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  const query = req.query || req.body; // type=video | type=audio, force=true

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .populate("meta", "detectedMime objectKey")
      .lean();

    if (!file) return badRequest(res, "File not found!");

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isPublic = file.publicRole === "VIEWER";
    const isShared = hasAccess(file, ["VIEWER", "EDITOR"], email);

    if (
      !isPublic &&
      !isShared &&
      !isOwner &&
      !req.isTokenAuthorized &&
      !SUPER_ROLES.includes(req.user.role)
    )
      return forbidden(res);

    const filePath = path.join(
      UPLOAD_ROOT,
      file.userId.toString(),
      file.meta.objectKey,
    );

    // Safety check: ensure inside upload root
    if (!existsSync(filePath))
      return notFound(res, "File missing from server.");

    //check preview/forcePreview
    if (file.disposition !== "inline") {
      if (
        query &&
        (query.type === "video" || query.type === "audio") &&
        file.meta.detectedMime.startsWith(query.type) &&
        file.force_inline_preview &&
        query.force === "true"
      ) {
        file.disposition = "inline";
        file.meta.detectedMime = file.mimetype;
      } else {
        return badRequest(res, "Preview not available.");
      }
    }

    const stat = statSync(filePath);
    //stream
    const range = req.headers.range;
    res.setHeader("Accept-Ranges", "bytes");

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "")?.split("-");

      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;

      // Ensure range is valid
      if (start >= stat.size || end >= stat.size) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
        return res.end();
      }

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": end - start + 1,
        "Content-Type": file.meta.detectedMime,
        "Content-Disposition": `${file.disposition}; filename="${file.filename}"`,
      });

      const stream = createReadStream(filePath, { start, end });

      stream.on("error", (streamErr) => {
        console.error("Stream error:", streamErr);
        if (!res.headersSent) res.status(500).end();
      });

      return stream.pipe(res);
    }

    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": file.meta.detectedMime,
      "Content-Disposition": `${file.disposition}; filename="${file.filename}"`,
    });

    const stream = createReadStream(filePath);
    stream.on("error", (streamErr) => {
      console.error("Stream error:", streamErr);
      if (!res.headersSent) res.status(500).end();
    });

    return stream.pipe(res);
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/download/:id
 * what it do: Stream the file as an attachment if requester has access.
 * requirements:
 *   - req.params: { id: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const downloadFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .populate({ path: "meta", select: "objectKey" })
      .lean();

    if (!file) return badRequest(res, "File not found!");

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isPublic = file.publicRole === "VIEWER";
    const isShared = hasAccess(file, ["VIEWER", "EDITOR"], email);

    if (
      !isPublic &&
      !isShared &&
      !isOwner &&
      !req.isTokenAuthorized &&
      !SUPER_ROLES.includes(req.user.role)
    )
      return forbidden(res);

    const filePath = path.join(
      UPLOAD_ROOT,
      file.userId.toString(),
      file.meta.objectKey,
    );

    // Safety check: ensure inside upload root
    if (!existsSync(filePath))
      return notFound(res, "File missing from server.");

    res.writeHead(200, {
      "Content-Length": statSync(filePath).size,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
    });

    const stream = createReadStream(filePath);

    stream.on("error", (streamErr) => {
      console.error("Stream error:", streamErr);
      if (!res.headersSent) res.status(500).end();
    });

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/rename/:id
 * what it do: Rename a file if requester is owner or has EDITOR access.
 * requirements:
 *   - req.params: { id: string }
 *   - req.body: { newname: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const renameFileHandler = async (req, res, next) => {
  let { newname } = req.body;

  if (!newname || typeof newname !== "string" || newname.length < 1)
    return badRequest(res, "Invalid name.");

  const badNameStr = [".", "/", "\\", ":", "*", '"', "<", ">", "?", "|"];
  if (badNameStr.includes(newname[0])) {
    return badRequest(
      res,
      `newname cannot start with Invalid characters: . / \ : * " < > ? |`,
    );
  }

  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).lean();

    if (!file) return badRequest(res, "File not found!");

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isShared = hasAccess(file, ["EDITOR"], email);

    if (!isShared && !isOwner) return forbidden(res);

    // const currExt = path.extname(file.name);
    // const reqExt = path.extname(newname);
    // const reqName = newname.trim();

    // const finalName = currExt === reqExt
    //     ? reqName
    //     : `${path.basename(reqName, reqExt)}${currExt}`;

    const renamed = await UserFile.updateOne(
      { _id: file._id },
      { $set: { filename: newname } },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: "File renamed.",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/copy/:id
 * what it do: Create a copy of the file into the target directory when permitted.
 * requirements:
 *   - req.params: { id: string } (file id)
 *   - req.body: { targetId: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const copyFileHandler = async (req, res, next) => {
  const { _id: targetDirId, userId: targetUserId } = req.parent;

  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    });

    if (!file) return badRequest(res, "File not found!");

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isShared = hasAccess(file, ["EDITOR"], email);

    if (!isShared && !isOwner) return forbidden(res);

    let { filename, parentId, ...rest } = getFileDoc(file);

    if (targetDirId.toString() !== parentId.toString()) parentId = targetDirId;
    else filename = `Copy-${filename}`;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Directory.findByIdAndUpdate(
          targetDirId,
          { $inc: { size: file.size } },
          { session },
        );

        await UserFile.create([{ filename, parentId, ...rest }], { session });

        if (file.meta)
          await FileModel.findByIdAndUpdate(
            file.meta._id,
            { $inc: { refCount: 1 } },
            { session },
          );
      });
    } finally {
      await session.endSession();
    }

    return res.status(201).json({
      success: true,
      message: "Copied to the target directory.",
    });
  } catch (err) {
    if (err.statusCode)
      return responsePayload(res, err.statusCode, err.message);
    next(err);
  }
};

/**
 * path: /api/files/move/:id
 * what it do: Move a file to a different directory when permitted.
 * requirements:
 *   - req.params: { id: string } (file id)
 *   - req.body: { targetId: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const moveFileHandler = async (req, res, next) => {
  const { _id: targetDirId } = req.body;

  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).lean();

    if (!file) return badRequest(res, "File not found!");
    if (file.parentId.toString() === targetDirId.toString())
      return badRequest(res, "File already in the target destination.");

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isShared = hasAccess(file, ["EDITOR"], email);

    if (!isShared && !isOwner) return forbidden(res);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Directory.findByIdAndUpdate(
          targetDirId,
          { $inc: { size: +file.size } },
          { session },
        );

        await UserFile.findByIdAndUpdate(
          file._id,
          { $set: { parentId: targetDirId } },
          { session },
        );

        await Directory.findByIdAndUpdate(
          file.parentId,
          { $inc: { size: -file.size } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    return res.status(200).json({
      success: true,
      message: "Moved to target directory.",
    });
  } catch (err) {
    if (err.statusCode)
      return responsePayload(res, err.statusCode, err.message);

    next(err);
  }
};

/**
 * path: /api/files/trash/:id
 * what it do: Move a file to the bin (soft-delete) if requester is owner or has EDITOR access.
 * requirements:
 *   - req.params: { id: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const moveToBinHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
      deletedBy: "none",
    });
    if (!file) return badRequest(res, "File not found!");

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isShared = hasAccess(file, ["EDITOR"], email);

    if (!isShared && !isOwner) return forbidden(res);

    await UserFile.findByIdAndUpdate(file._id, {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: "user",
      },
    });

    return res
      .status(200)
      .json({ success: true, message: "File moved to bin." });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/restore/:id
 * what it do: Restore a previously soft-deleted file if requester is owner or has EDITOR access.
 * requirements:
 *   - req.params: { id: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const restoreFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: true,
      deletedBy: "user",
    });
    if (!file) return badRequest(res, "File not found!");

    const directory = await Directory.findOne({
      _id: file.parentId,
      isDeleted: false,
    });

    if (!directory)
      return badRequest(
        res,
        "Parent directory does not exist. Restore parent first.",
      );

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isShared = hasAccess(file, ["EDITOR"], email);

    if (!isShared && !isOwner) return forbidden(res);

    // const { _id: uid, rootDirId } = file.userId;
    // const rfp = await restoreFileParent(uid, file, rootDirId);

    await UserFile.findByIdAndUpdate(
      file._id,
      {
        $set: {
          isDeleted: false,
          deletedAt: null,
          deletedBy: "none",
        },
      },
      { new: true },
    );

    return res.status(200).json({ message: "file restored." });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/delete/:id
 * what it do: Permanently delete a file and decrease reference count; may delete physical file when no refs remain.
 * requirements:
 *   - req.params: { id: string }
 *   - req.user: authenticated user object; typically only owner can delete
 */
export const deleteFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  const session = await mongoose.startSession();
  let filePathToDelete = null;
  try {
    await session.withTransaction(async () => {
      const file = await UserFile.findOneAndDelete({
        _id: req.params.id,
        userId: req.user._id,
      })
        .populate({ path: "meta", select: "objectKey" })
        .session(session);

      await Directory.findOneAndUpdate(
        { _id: file.parentId },
        { $inc: { size: -file.size } },
        { session },
      );

      let updatedFile = null;
      if (file.meta)
        updatedFile = await FileModel.findOneAndUpdate(
          { _id: file.meta._id, refCount: { $gt: 0 } },
          { $inc: { refCount: -1 } },
          { session },
        ).select("_id objectKey refCount");

      if (updatedFile && updatedFile.refCount <= 0) {
        await FileModel.deleteOne({ _id: updatedFile._id });
        filePathToDelete = path.join(
          UPLOAD_ROOT,
          file.userId.toString(),
          file.meta.objectKey,
        );
      }
    });

    if (filePathToDelete) {
      unlink(filePathToDelete).catch((err) => {
        // Ignore "File not found" errors, log everything else
        if (err.code !== "ENOENT") {
          console.error(
            `Failed to delete file physically: ${filePathToDelete}`,
            err,
          );
        }
      });
    }

    return res.status(200).json({
      message: "File deletion successful and no longer available.",
    });
  } catch (err) {
    next(err);
  } finally {
    if (session) await session.endSession();
  }
};

/**
 * path: /api/files/share/:id
 * what it do: Change sharing settings for a file — set `publicRole` and add/update `sharedWith` entries; only the file owner may perform this action.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { emailsWithRole?: [{ email, role }], publicRole?: 'VIEWER'|'NONE', notify?: boolean }
 *   - req.user: authenticated user object provided by `validateSession` (must be directory owner)
 *   - When used with `shareHandlerPreProcessor` middleware, expects `req.shareConfig` and responds with `{ accepted, skipped, shareToken }`
 */
export const shareFileHandler = async (req, res, next) => {
  const { notify } = req.body;
  const { updateQuery, emailsToUpdate, accepted, skipped } = req.shareConfig;

  const session = await mongoose.startSession();
  let shareToken = null;

  try {
    await session.withTransaction(async () => {
      const file = await UserFile.findOne({
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: false,
      })
        .select("_id shareToken")
        .session(session)
        .lean();

      if (!file) return notFound(res, "File not found.");
      if (!file.shareToken) {
        shareToken = base64URLEncode(crypto.randomBytes(32));
        updateQuery.$set.shareToken = shareToken;
      } else shareToken = file.shareToken;

      await UserFile.findOneAndUpdate(
        { _id: req.params.id, userId: req.user._id, isDeleted: false },
        { $pull: { sharedWith: { email: { $in: emailsToUpdate } } } },
        { new: true, session },
      );

      await UserFile.findByIdAndUpdate(file._id, updateQuery).session(session);
    });

    res.status(200).json({
      success: true,
      message: "Permission changed for this file.",
      accepted,
      skipped,
    });

    if (notify) {
      //send notification to accepted emails
      console.log("emails sent.");
    }
    return;
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
};

/**
 * path: /api/files/public-role/:id
 * what it do: Change the `publicRole` for a file (e.g. make file publicly viewable or revoke public access).
 * requirements:
 *   - req.params: { id: string } (file id)
 *   - req.body: { publicRole?: 'VIEWER'|'NONE' }
 *   - req.user: authenticated user object provided by `validateSession` (must be file owner)
 */
export const filePublicRoleHandler = async (req, res, next) => {
  const { publicRole } = req.body;
  const allowedPublicRoles = ["VIEWER", "NONE"];

  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  const formattedPublicRole = publicRole ? publicRole.toUpperCase() : undefined;
  if (!formattedPublicRole || !allowedPublicRoles.includes(formattedPublicRole))
    return badRequest(res, "Invalid `publicRole`.");

  const updateQuery = { $set: { publicRole: formattedPublicRole } };
  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    })
      .select("_id shareToken")
      .lean();

    if (!file) return notFound(res, "File not found.");
    if (!file.shareToken) {
      shareToken = base64URLEncode(crypto.randomBytes(32));
      updateQuery.$set.shareToken = shareToken;
      updateQuery.$set.sharedAt = new Date();
    } else shareToken = file.shareToken;

    await UserFile.findOneAndUpdate(
      { _id: file._id, isDeleted: false },
      updateQuery,
    );

    return res.status(200).json({
      success: true,
      message: "Permission for this file has changed.",
      data: { token: shareToken },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/new-token/:id
 * what it do: Generate a new `shareToken` for the file and persist it (owner-only). The token is propagated where applicable.
 * requirements:
 *   - req.params: { id: string } (file id)
 *   - req.user: authenticated user object provided by `validateSession` (must be file owner)
 * returns:
 *   - 200 with { shareToken, id }
 */
export const getFileShareToken = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    });
    if (!file) return notFound(res, "File not found.");
    if (file.publicRole !== "VIEWER" && file.sharedWith.length < 1)
      return responsePayload(
        res,
        403,
        "Cannot perform revoke on a non-shared item.",
      );

    const shareToken = base64URLEncode(crypto.randomBytes(32));
    await UserFile.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, isDeleted: false },
      { $set: { shareToken } },
      { new: true },
    ).select("_id");

    return res.status(200).json({
      success: true,
      message: "Token created for the file.",
      data: { newToken: shareToken },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/revoke-access/:id
 * what it do: Remove listed emails from a file's `sharedWith`. If no remaining shared users and `publicRole` is `NONE`, clears `shareToken`/`sharedAt`.
 * requirements:
 *   - req.params: { id: string } (file id)
 *   - req.body: { emails: [string] }
 *   - req.user: authenticated user object provided by `validateSession` (must be file owner)
 */
export const revokeAccessFileHandler = async (req, res, next) => {
  const { emails, publicRole } = req.body;
  if (!emails || !Array.isArray(emails))
    return badRequest(res, "Invalid payload");

  const formattedPublicRole = publicRole ? publicRole.toUpperCase() : undefined;
  if (formattedPublicRole && formattedPublicRole !== "NONE")
    return badRequest(res, "Invalid `publicRole`.");

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    })
      .select("_id sharedWith publicRole")
      .lean();

    if (!file) return notFound(res, "file not found.");
    if (file.publicRole !== "VIEWER" && file.sharedWith.length < 1)
      return responsePayload(
        res,
        403,
        "Cannot perform revoke on a non-shared item.",
      );

    const skipped = [];
    const emailsToUpdate = [];

    emails.forEach((email) => {
      const ce = email.toLowerCase().trim();
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ce))
        skipped.push(ce);
      else emailsToUpdate.push(ce);
    });

    let updateQuery = {};
    if (emailsToUpdate.length > 0)
      updateQuery.$pull = { sharedWith: { email: { $in: emailsToUpdate } } };
    if (formattedPublicRole)
      updateQuery.$set = { publicRole: formattedPublicRole };

    const updatedFile = await UserFile.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, isDeleted: false },
      updateQuery,
      { new: true },
    ).select("sharedWith publicRole");

    if (updatedFile.sharedWith.length < 1 && updatedFile.publicRole === "NONE")
      await UserFile.findByIdAndUpdate(updatedFile._id, {
        $set: { sharedAt: null, shareToken: "" },
      });

    return res.status(200).json({
      success: true,
      message: "Permission changed for this file.",
      accepted: emailsToUpdate,
      skipped,
    });
  } catch (err) {
    next(err);
  }
};
