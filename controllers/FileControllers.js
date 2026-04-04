import path from "node:path";
import mongoose from "mongoose";
import crypto from "crypto";
import { existsSync, createReadStream, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { File } from "../models/file.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { User } from "../models/user.model.js";
import { SUPER_ROLES } from "../misc/constants.js";
import { base64URLEncode } from "./oauthControllers.js";
import { UPLOAD_ROOT } from "../misc/constants.js";
import { getErrorObject, getFileDoc, hasAccess } from "../utils/helper.js";
import { filenameSchema, uploadInitSchema } from "../Schemas/userSchema.js";

//API Handlers

/**
 * path: /api/files/info/:id
 * what it do: Return metadata for a single file if requester is owner, shared user, or file is public.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getFileInfoHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select(
        "-__v -sharedBy -deletedBy -deletedAt -shareToken -sharedAt  -isDeleted -meta",
      )
      .populate("userId", "name email avatar")
      .lean();

    if (!file) return next(getErrorObject("File not found.", 404));

    const isOwner = file.userId._id.toString() === req.user._id.toString();
    const isPublic = file.publicRole === "VIEWER";
    const isShared = hasAccess(file, ["VIEWER", "EDITOR"], req.user.email);

    if (
      !isPublic &&
      !isShared &&
      !isOwner &&
      !req.isTokenAuthorized &&
      !SUPER_ROLES.includes(req.user.role)
    )
      return next(getErrorObject("You don't have this permission.", 403));

    const { sharedWith, publicRole, userId, ...fileData } = file;
    const owner = {
      name: userId.name,
      email: userId.email,
      avatar: userId.avatar,
    };
    return res
      .status(200)
      .json({
        success: true,
        message: "File found.",
        data: { file: { ...fileData, owner } },
      });
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
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  const query = req.query || req.body; // type=video | type=audio, force=true

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select(
        "filename userId sharedWith publicRole meta disposition force_inline_preview",
      )
      .populate("meta", "detectedMime objectKey")
      .lean();

    if (!file || !file.meta?.objectKey)
      return next(getErrorObject("File not found.", 404));

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
      return next(getErrorObject("You don't have this permission.", 403));

    const filePath = path.resolve(
      UPLOAD_ROOT,
      file.userId.toString(),
      file.meta.objectKey,
    );
    if (!filePath.startsWith(path.resolve(UPLOAD_ROOT) + path.sep))
      return next("Invalid file path.");
    if (!existsSync(filePath)) return next("File missing from server.");

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
        return next(getErrorObject("Preview not available."));
      }
    }

    const { success, data } = uploadInitSchema.shape.mime.safeParse(
      file.meta.detectedMime,
    );
    const safeMime = success ? data : "application/octet-stream";

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
        "Content-Type": safeMime,
        "Content-Disposition": `${file.disposition}; filename="${file.filename}"`,
        "X-Content-Type-Options": "nosniff",
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
      "Content-Type": safeMime,
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
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("filename userId sharedWith publicRole meta linkMeta")
      .populate("meta", "objectKey")
      .lean();

    if (!file && !file.meta?.objectKey && !file.linkMeta)
      return next(getErrorObject("File not found.", 404));

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
      return next(getErrorObject("You don't have this permission.", 403));

    if (file.linkMeta) {
      return res.status(200).json({ data: file.linkMeta });
    }

    const filePath = path.resolve(
      UPLOAD_ROOT,
      file.userId.toString(),
      file.meta.objectKey,
    );
    if (!filePath.startsWith(path.resolve(UPLOAD_ROOT) + path.sep))
      return next("Invalid file path");
    if (!existsSync(filePath)) return next("File missing from server");

    res.writeHead(200, {
      "Content-Length": statSync(filePath).size,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "X-Content-Type-Options": "nosniff",
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
 *   - req.body: { name: string }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const renameFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const { success, data, error } = filenameSchema.safeParse(req.body);
    if (!success) return next(getErrorObject(error.issues[0].message));

    const { name } = data;
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId sharedWith")
      .lean();

    if (!file) return next(getErrorObject("File not found.", 404));

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isShared = hasAccess(file, ["EDITOR"], email);
    if (!isShared && !isOwner)
      return next(getErrorObject("You don't have this permission.", 403));

    // const currExt = path.extname(file.name);
    // const reqExt = path.extname(newname);
    // const reqName = newname.trim();

    // const finalName = currExt === reqExt
    //     ? reqName
    //     : `${path.basename(reqName, reqExt)}${currExt}`;

    const renamed = await UserFile.findOneAndUpdate(
      { _id: file._id, isDeleted: false },
      { $set: { filename: name } },
      { returnDocument: "after" },
    )
      .select("_id filename")
      .lean();

    if (!renamed) return next(getErrorObject("File not found.", 404));

    return res
      .status(200)
      .json({
        success: true,
        message: "File renamed",
        data: { file: renamed },
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
  const {
    _id: targetParentId,
    userId: targetUser,
    sharedWith,
    publicRole,
    shareToken,
  } = req.parent;

  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).lean();

    if (!file) return next(getErrorObject("File not found.", 404));
    if (
      parseInt(file.size) >
      targetUser.allotedStorage - targetUser.usedStorage
    ) {
      return next(getErrorObject("Insufficient storage."));
    }

    const { _id: userId, email } = req.user;
    const isOwner =
      file.userId.toString() === userId.toString() &&
      targetUser._id.toString() === userId.toString();
    const isShared = email
      ? hasAccess(file, ["EDITOR"], email) &&
        hasAccess(req.parent, ["EDITOR"], email)
      : false;
    if (!isShared && !isOwner)
      return next(getErrorObject("You don't have this permission.", 403));

    let { filename, parentId, userId: fileUserId, ...rest } = getFileDoc(file);

    if (targetParentId.toString() !== parentId.toString())
      parentId = targetParentId;
    else filename = `Copy-${filename}`;

    if (!isOwner) fileUserId = targetUser._id;

    const session = await mongoose.startSession();
    let newFile = null;
    try {
      await session.withTransaction(async () => {
        await Directory.updateOne(
          { _id: targetParentId },
          { $inc: { size: file.size } },
          { session },
        );

        await User.updateOne(
          { _id: targetUser._id },
          { $inc: { usedStorage: file.size } },
          { session },
        );

        [newFile] = await UserFile.create(
          [
            {
              filename,
              parentId,
              userId: fileUserId,
              ...rest,
              sharedWith,
              publicRole,
              shareToken,
              sharedBy:
                publicRole !== "NONE" || sharedWith.length > 0
                  ? "process"
                  : "none",
              sharedAt:
                publicRole !== "NONE" || sharedWith.length > 0
                  ? new Date()
                  : null,
            },
          ],
          { session },
        );

        if (file.meta)
          await File.updateOne(
            { _id: file.meta },
            { $inc: { refCount: 1 } },
            { session },
          );
      });
    } finally {
      await session.endSession();
    }

    if (!newFile) throw Error("Failed to create file entry");
    const fileDoc = getFileDoc(newFile);
    return res
      .status(201)
      .json({
        success: true,
        message: "Copied to the target directory.",
        data: { file: fileDoc },
      });
  } catch (err) {
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
  const {
    _id: targetParentId,
    userId: targetUser,
    sharedWith,
    publicRole,
    shareToken,
  } = req.parent;

  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("userId sharedWith parentId size")
      .lean();

    if (!file) return next(getErrorObject("File not found.", 404));
    if (file.parentId.toString() === targetParentId.toString())
      return next(
        getErrorObject("File already in the target destination.", 403),
      );

    const { _id: userId, email } = req.user;
    const isOwner =
      file.userId.toString() === userId.toString() &&
      targetUser._id.toString() === userId.toString();
    const isShared = email
      ? hasAccess(file, ["EDITOR"], email) &&
        hasAccess(req.parent, ["EDITOR"], email)
      : false;
    if (!isShared && !isOwner) return;

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await UserFile.updateOne(
          { _id: file._id },
          {
            $set: {
              parentId: targetParentId,
              sharedWith,
              publicRole,
              shareToken,
              sharedBy:
                publicRole !== "NONE" || sharedWith.length > 0
                  ? "process"
                  : "none",
              sharedAt:
                publicRole !== "NONE" || sharedWith.length > 0
                  ? new Date()
                  : null,
            },
          },
          { session },
        );
        await Directory.updateOne(
          { _id: targetParentId },
          { $inc: { size: file.size } },
          { session },
        );
        await Directory.updateOne(
          { _id: file.parentId },
          { $inc: { size: -file.size } },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    return res
      .status(200)
      .json({
        success: true,
        message: "Moved to target directory.",
        data: { file: { _id: req.params.id, parentId: targetParentId } },
      });
  } catch (err) {
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
    return next(getErrorObject("Invalid id."));

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
      deletedBy: "none",
    })
      .select("userId sharedWith")
      .lean();

    if (!file) return next(getErrorObject("File not found.", 404));

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isShared = hasAccess(file, ["EDITOR"], email);
    if (!isShared && !isOwner)
      return next(getErrorObject("You don't have this permission.", 403));

    const binned = await UserFile.findByIdAndUpdate(
      file._id,
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: "user",
        },
      },
      { returnDocument: "after" },
    )
      .select("_id filename parentId isDeleted")
      .lean();

    return res
      .status(200)
      .json({
        success: true,
        message: "File moved to bin.",
        data: { file: binned },
      });
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
    return next(getErrorObject("Invalid id."));

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: true,
      deletedBy: "user",
    })
      .select("userId sharedWith parentId")
      .lean();
    if (!file) return next(getErrorObject("File not found.", 404));

    const directory = await Directory.findOne({
      _id: file.parentId,
      isDeleted: false,
    });

    if (!directory)
      return next(
        getErrorObject("Parent does not exist. Restore parent first."),
      );

    const { _id: userId, email } = req.user;
    const isOwner = file.userId.toString() === userId.toString();
    const isShared = hasAccess(file, ["EDITOR"], email);
    if (!isShared && !isOwner)
      return next(getErrorObject("You don't have this permission.", 403));

    // const { _id: uid, rootDirId } = file.userId;
    // const rfp = await restoreFileParent(uid, file, rootDirId);

    const restored = await UserFile.findByIdAndUpdate(
      file._id,
      {
        $set: {
          isDeleted: false,
          deletedAt: null,
          deletedBy: "none",
        },
      },
      { returnDocument: "after" },
    )
      .select("_id, filename, parentId isDeleted")
      .lean();

    return res
      .status(200)
      .json({
        success: true,
        message: "file restored.",
        data: { file: restored },
      });
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
    return next(getErrorObject("Invalid id."));

  try {
    const session = await mongoose.startSession();
    let filePathToDelete = null;
    try {
      await session.withTransaction(async () => {
        const file = await UserFile.findOneAndDelete({
          _id: req.params.id,
          userId: req.user._id,
        })
          .select("userId parentId size meta")
          .populate({ path: "meta", select: "refCount objectKey" })
          .session(session)
          .lean();

        await Directory.updateOne(
          { _id: file.parentId },
          { $inc: { size: -file.size } },
          { session },
        );

        await User.updateOne(
          { _id: req.user._id },
          { $inc: { usedStorage: -file.size } },
          { session },
        );

        let uf = null;

        if (file.meta && file.meta.refCount - 1 > 0) {
          uf = await File.findByIdAndUpdate(
            file.meta._id,
            { $inc: { refCount: -1 } },
            { session, returnDocument: "after" },
          )
            .select("objectKey")
            .lean();
        } else if (file.meta && file.meta.refCount - 1 <= 0) {
          uf = await File.findByIdAndDelete(file.meta._id, { session })
            .select("objectKey")
            .lean();

          const deletePath = path.resolve(
            UPLOAD_ROOT,
            file.userId.toString(),
            uf.objectKey,
          );

          if (deletePath.startsWith(path.resolve(UPLOAD_ROOT) + path.sep))
            filePathToDelete = deletePath;
        }
      });
    } finally {
      await session.endSession();
    }

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
      success: true,
      message: "File permanently deleted and no longer available.",
      data: { file: { _id: req.params.id } },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/share/:id
 * what it do: Change sharing settings for a file — set `publicRole` and add/update `sharedWith` entries; only the file owner may perform this action.
 * requirements:
 *   - req.params: { id: string } (directory id)
 *   - req.body: { emailsWithRole?: [{ email, role }], publicRole?: 'VIEWER'|'NONE', notify?: boolean, message?; string}
 *   - req.user: authenticated user object provided by `validateSession` (must be directory owner)
 *   - When used with `shareHandlerPreProcessor` middleware, expects `req.shareConfig` and responds with `{ accepted, skipped, shareToken }`
 */
export const shareFileHandler = async (req, res, next) => {
  const { notify, message } = req.body;
  const { updateQuery, emailsToUpdate, accepted, skipped } = req.shareConfig;

  try {
    const session = await mongoose.startSession();
    let shareToken = null;
    let updated = null;
    try {
      await session.withTransaction(async () => {
        const file = await UserFile.findOne({
          _id: req.params.id,
          isDeleted: false,
        })
          .select("_id userId shareToken")
          .session(session)
          .lean();

        if (!file) throw getErrorObject("File not found.", 404);

        if (file.userId.toString() !== req.user._id.toString()) {
          const error = new Error("You don't have this permission.");
          error.statusCode = 403;
          throw error;
        }

        if (!file.shareToken) {
          shareToken = base64URLEncode(crypto.randomBytes(32));
          updateQuery.$set.shareToken = shareToken;
        } else shareToken = file.shareToken;

        await UserFile.updateOne(
          { _id: req.params.id, userId: req.user._id, isDeleted: false },
          { $pull: { sharedWith: { email: { $in: emailsToUpdate } } } },
          { returnDocument: "after", session },
        );

        updateQuery.$set.sharedBy = "user";
        updated = await UserFile.findByIdAndUpdate(file._id, updateQuery, {
          session,
          returnDocument: "after",
        })
          .select("sharedWith -_id")
          .lean();
      });
    } finally {
      await session.endSession();
    }

    // if (notify) {
    //   //send notification to accepted emails
    //   // await sendEmails(accepted, message)
    //   // console.log("emails sent");
    // }

    res.status(200).json({
      success: true,
      message: `Share permission changed for ${accepted.length} people. Share permission changed at a depth of ${depth}`,
      data: { sharedWith: updated.sharedWith, shareToken, accepted },
    });
  } catch (err) {
    next(err);
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
    return next(getErrorObject("Invalid id."));

  const formattedPublicRole = publicRole
    ? String(publicRole).toUpperCase()
    : undefined;
  if (!formattedPublicRole || !allowedPublicRoles.includes(formattedPublicRole))
    return next(getErrorObject("Invalid payload."));

  const updateQuery = { $set: { publicRole: formattedPublicRole } };
  let shareToken = null;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const file = await UserFile.findOne({
        _id: req.params.id,
        isDeleted: false,
      })
        .select("_id userId shareToken sharedWith")
        .session(session)
        .lean();

      if (!file) throw getErrorObject("File not found.", 404);

      if (file.userId.toString() !== req.user._id.toString()) {
        throw getErrorObject("You don't have this permission.", 403);
      }

      if (formattedPublicRole === "NONE" && file.sharedWith.length < 1)
        updateQuery.$set.sharedBy = "none";
      else updateQuery.$set.sharedBy = "user";

      if (!file.shareToken && updateQuery.$set.sharedBy === "user") {
        shareToken = base64URLEncode(crypto.randomBytes(32));
        updateQuery.$set.shareToken = shareToken;
        updateQuery.$set.sharedAt = new Date();
      } else shareToken = file.shareToken;

      await UserFile.updateOne({ _id: file._id }, updateQuery, {
        session,
      }).lean();
    });

    return res.status(200).json({
      success: true,
      message: "Public permission changed.",
      data: { publicRole: formattedPublicRole, shareToken },
    });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
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
export const getNewFileShareToken = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  const shareToken = base64URLEncode(crypto.randomBytes(32));
  try {
    const file = await UserFile.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: false,
        sharedBy: { $ne: "none" },
      },
      { $set: { shareToken, sharedBy: "user" } },
      { returnDocument: "after" },
    )
      .select("_id")
      .lean();

    if (!file) return next(getErrorObject("File not found.", 404));
    return res.status(200).json({
      success: true,
      message: "New token created.",
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
  const { updateQuery, emailsToUpdate, formattedPublicRole } = req.revokeConfig;

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
      sharedBy: { $ne: "none" },
    })
      .select("_id sharedWith publicRole")
      .lean();

    if (!file) return next(getErrorObject("file not found.", 404));
    if (file.publicRole !== "VIEWER" && file.sharedWith.length < 1)
      return next(
        getErrorObject("Cannot perform revoke on a non-shared item.", 403),
      );

    const session = await mongoose.startSession();
    let updated = null;
    try {
      await session.withTransaction(async () => {
        updated = await UserFile.findOneAndUpdate(
          { _id: req.params.id, userId: req.user._id, isDeleted: false },
          updateQuery,
          { returnDocument: "after", session },
        )
          .select("_id sharedWith publicRole")
          .lean();

        if (updated.sharedWith.length < 1 && updated.publicRole === "NONE")
          await UserFile.updateOne(
            { _id: updated._id },
            { $set: { sharedAt: null, shareToken: "", sharedBy: "none" } },
            { session },
          );
      });
    } finally {
      session.endSession();
    }

    return res.status(200).json({
      success: true,
      message: `Share permission revoked for ${emailsToUpdate.length} people. Permission revoked at a depth of ${depth}`,
      data: {
        sharedWith: updated.sharedWith,
        publicRole: updated.publicRole,
        revoked: emailsToUpdate,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/starred/:id
 * what it do: Mark file/s as starred/non-starred as per user request.
 * requirements:
 *   - req.params: { id: string } (file id)
 *   - req.body: { starred: boolean }
 *   - req.user: authenticated user object provided by `validateSession` (must be file owner)
 */
export const makeFileStarred = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  const { starred } = req.body;
  if (typeof starred !== "boolean")
    return next(getErrorObject("Invalid payload."));
  try {
    const file = await UserFile.findOneAndUpdate(
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
    if (!file)
      return next(
        getErrorObject(
          `${starred ? "Starred" : "Non-starred"} file not found.`,
          404,
        ),
      );

    return res
      .status(201)
      .json({ success: true, message: "Properties changed.", data: { file } });
  } catch (err) {
    next(err);
  }
};
