import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";
import { unlink } from "node:fs/promises";
import { restoreFile } from "../utils/restore.js";
import {
  badRequest,
  notFound,
  getFileDoc,
  getMetadata,
} from "../utils/helper.js";

import { File as FileModel } from "../models/file.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";

//env variables
const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

//API Handlers

export const getFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    }).lean();

    if (!file) return notFound(res, "File not found.");

    return res
      .status(200)
      .json({ success: true, message: "file found.", data: { file } });
  } catch (err) {
    next(err);
  }
};

export const previewFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  const query = req.query || req.body; // type=video | type=audio, force=true

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    })
      .populate({ path: "meta", select: "objectKey detectedMime size" })
      .lean();

    if (!file) {
      return notFound(res, "File not found.");
    }

    const absolutePath = path.join(
      UPLOAD_ROOT,
      req.user._id.toString(),
      file.meta.objectKey,
    );

    res.setHeader("Accept-Ranges", "bytes");

    // Safety check: ensure inside upload root
    if (!absolutePath.startsWith(UPLOAD_ROOT) || !fs.existsSync(absolutePath))
      throw new Error("Error occurred during execution!!");

    //check preview/forcePreview
    if (
      file.disposition !== "inline" &&
      query &&
      (query.type === "video" || query.type === "audio") &&
      file.meta.detectedMime.startsWith(query.type) &&
      file.force_inline_preview &&
      query.force === "true"
    ) {
      file.disposition = "inline";
      file.meta.detectedMime = file.mimetype;
    } else return badRequest(res, "Not available for preview.");

    const stat = fs.statSync(absolutePath);

    //stream
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, "")?.split("-");

      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": end - start + 1,
      });

      return fs.createReadStream(absolutePath, { start, end }).pipe(res);
    }

    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": file.meta.detectedMime,
      "Content-Disposition": `${file.disposition}; filename="${file.name}"`,
    });

    return fs.createReadStream(absolutePath).pipe(res);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

export const downloadFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    })
      .populate({ path: "meta", select: "objectKey" })
      .lean();

    if (!file) {
      return notFound(res, "File not found.");
    }

    const absolutePath = path.join(
      UPLOAD_ROOT,
      req.user._id.toString(),
      file.meta.objectKey,
    );

    // Safety check: ensure inside upload root
    if (!absolutePath.startsWith(UPLOAD_ROOT) || !fs.existsSync(absolutePath))
      throw new Error("Error occurred during execution!!");

    res.writeHead(200, {
      "Content-Length": fs.statSync(absolutePath).size,
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.name}"`,
    });

    return fs.createReadStream(absolutePath).pipe(res);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

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
      userId: req.user._id,
      isDeleted: false,
    }).lean();

    if (!file) return notFound(res, "File not found.");

    // const currExt = path.extname(file.name);
    // const reqExt = path.extname(newname);
    // const reqName = newname.trim();

    // const finalName = currExt === reqExt
    //     ? reqName
    //     : `${path.basename(reqName, reqExt)}${currExt}`;

    const renamed = await UserFile.updateOne(
      { _id: file._id },
      { $set: { name: newname, updatedAt: new Date() } },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: "File renamed.",
      data: { file: renamed },
    });
  } catch (err) {
    next(err);
  }
};

export const copyFileHandler = async (req, res, next) => {
  const { targetId } = req.body;

  if (!targetId) return badRequest(res, "Invalid payload.");
  if (
    !mongoose.isValidObjectId(req.params.id) ||
    !mongoose.isValidObjectId(targetId)
  ) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const targetDir = await Directory({
      _id: targetId,
      userId: req.user._id,
      isDeleted: false,
    });
    if (!targetDir) return notFound(res, "Target not found.");

    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    }).lean();

    if (!file) return notFound(res, "File not found.");

    const fileDoc = getFileDoc(file);

    fileDoc.name = targetId === file.parentId ? file.name : `Copy-${file.name}`;
    fileDoc.parentId = targetId ? targetId : file.parentId;
    fileDoc.meta = file.meta._id;

    const copied = await UserFile.insertOne(fileDoc);

    await FileModel.UpdateOne(
      { _id: file.meta._id },
      { $inc: { refCount: 1 } },
    );

    await Directory.updateOne({ _id: targetId }, { $inc: { size: file.size } });

    return res.status(201).json({
      success: true,
      message: "Copied to the target.",
      data: { file: copied },
    });
  } catch (err) {
    next(err);
  }
};

export const moveFileHandler = async (req, res, next) => {
  const { targetId } = req.body;

  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const targetDir = await Directory.findOne({
      _id: targetId,
      userId: req.user._id,
      isDeleted: false,
    });
    if (!targetDir) return notFound(res, "Target not found.");

    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    }).lean();
    if (!file) return notFound(res, "File not found.");

    if (file.parentId.toString() === targetId.toString()) {
      return badRequest(res, "File already in the target destination.");
    }

    await Directory.updateOne(
      { _id: file.parentId },
      { $inc: { size: -file.size } },
    );

    const moved = await UserFile.updateOne(
      { _id: file._id },
      { $set: { parentId: targetId, updatedAt: new Date() } },
    );

    await Directory.updateOne(
      { _id: targetId },
      { $inc: { size: +file.size } },
    );

    return res.status(200).json({
      success: true,
      message: "Moved to target destination.",
      file: moved,
    });
  } catch (err) {
    next(err);
  }
};

export const moveToBinHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
      deletedBy: "none",
    })
      .populate({ path: "meta", select: "objectKey detectedMime size" })
      .lean();

    if (!file) return badRequest(res, "file not found.");

    const op = await UserFile.findOneAndUpdate(
      { _id: file._id },
      {
        $set: {
          isDeleted: true,
          updatedAt: new Date(),
          deletedAt: new Date(),
          deletedBy: "user",
        },
      },
      { new: true },
    );

    return res.status(200).json({ message: "File moved to bin.", data: op });
  } catch (err) {
    next(err);
  }
};

export const restoreFileHandler = async (req, res, next) => {
  const userId = req.user._id;

  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  try {
    const file = await UserFile.findOne(
      {
        _id: req.params.id,
        userId,
        isDeleted: true,
        deletedBy: "user",
      },
      {
        $set: {
          isDeleted: false,
          deletedBy: "none",
          updatedAt: new Date(),
        },
      },
    )
      .populate({ path: "meta", select: "objectKey detectedMime size" })
      .lean();

    if (!file) return notFound(res, "file not found.");

    const op = await restoreFile(userId, file, req.user.rootDirId);

    return res.status(200).json({ message: "file restored.", data: op });
  } catch (err) {
    next(err);
  }
};

export const deleteFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
    })
      .populate({ path: "meta", select: "objectKey" })
      .lean();

    if (!file) return notFound(res, "File not found.");

    await UserFile.deleteOne({ _id: file._id });

    const updt = await FileModel.findOneAndUpdate(
      { _id: file.meta._id, refCount: { $gt: 0 } },
      { $inc: { refCount: -1 } },
      { new: true },
    );

    await Directory.findOneAndUpdate(
      { _id: file.parentId },
      { $inc: { size: -file.size } },
    );

    if (updt && updt.refCount <= 0) {
      //delete from db
      await FileModel.deleteOne({ _id: updt._id });

      //delete  from local
      const absolutePath = path.join(
        UPLOAD_ROOT,
        req.user._id.toString(),
        file.meta.objectKey,
      );

      try {
        await unlink(absolutePath);
        console.info(`${file.name} file unlinked.`);
      } catch (err) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    }

    return res.status(200).json({
      message: "File deletion successful and no longer available.",
    });
  } catch (err) {
    next(err);
  }
};

export const shareFileHandler = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return badRequest(res, "Invalid id.");

    //emailWithRole: [{email: "", role:""}], publicRole: "", notify: true
    const { emailsWithRole, publicRole, notify } = req.body;

    if (!emailsWithRole && !publicRole)
      return badRequest(res, "Invalid payload.");

    if (
      publicRole &&
      !["VIEWER", "COMMENTER", "EDITOR"].includes(role.toUpperCase())
    )
      return badRequest(res, "Invalid `publicRole`.");

    const file = await UserFile.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    }).lean();

    if (!file) return notFound(res, "File not found.");

    const validEmails = [];
    const skipped = [];

    for (const { email, role } of emailsWithRole) {
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
        skipped.push({ email, role, reason: "invalid email." });
      } else if (
        role &&
        !["VIEWER", "COMMENTER", "EDITOR"].includes(role.toUpperCase())
      ) {
        skipped.push({ email, role, reason: "invalid role." });
      } else
        validEmails.push({
          email,
          role: role.toUpperCase(),
          sharedAt: Date.now(),
        });
    }

    const shareToken = base64URLEncode(crypto.randomBytes(24)).toString(
      "base64url",
    );

    await UserFile.findByIdAndUpdate(file._id, {
      $push: { sharedWith: { $each: validEmails } },
      updatedAt: Date.now(),
    });

    res.status(200).json({
      success: true,
      message: "Permission changed for this file.",
      skippedEmails: skipped,
      acceptedEmails: validEmails,
      shareItemId: file._id.toString(),
    });

    if (notify && validEmails.length > 0) {
      //send notification to validEmails
      console.log("emails sent.");
    }

    return res.end();
  } catch (err) {
    next(err);
  }
};
