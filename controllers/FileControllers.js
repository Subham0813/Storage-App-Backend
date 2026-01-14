import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";

import { unlink } from "node:fs/promises";
import { fileTypeFromFile } from "file-type";
import {
  INLINE_MIME,
  INLINE_MIME_AUDIO_VIDEO_EXT,
} from "../configs/mimeSet.js";
import { restoreFile } from "../utils/restore.js";

import {
  badRequest,
  notFound,
  getFileDoc,
  getMetadata,
} from "../utils/helper.js";

import { File as FileModel } from "../models/file.model.js";
import { UserFile } from "../models/user_file.model.js";

//env variables
const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

//API Handlers

// const handleCreateFile = async (req, res, next) => {
//   const parent = req.parentDir;
//   const multerFile = req.file;
//   const userId = req.user._id;

//   if (!multerFile) {
//     return badRequest(res, "No file in the request!!");
//   }

//   if (multerFile.size === 0) {
//     await unlink(multerFile.path);
//     return badRequest(res, "Empty file upload is not allowed!!");
//   }

//   try {
//     const detected = await fileTypeFromFile(multerFile.path);
//     const detectedMime = detected?.mime || "application/octet-stream";
//     const disposition = INLINE_MIME.has(detectedMime) ? "inline" : "attachment";

//     const userFileDoc = getFileDoc(multerFile);
//     userFileDoc.userId = userId;
//     userFileDoc.parentId = parent?._id || null;
//     userFileDoc.disposition = disposition;
//     userFileDoc.inline_preview = disposition === "inline";
//     userFileDoc.force_inline_preview = INLINE_MIME.has(multerFile.mimetype);

//     const hash = await getFileHash(multerFile.path, "sha256", "base64url");
//     const finalPath = path.join(UPLOAD_ROOT, hash);

//     const exist = await FileModel.findOne({ hash }).lean();
//     let meta = null;

//     if (!exist) {
//       await rename(multerFile.path, finalPath);
//       multerFile.path = finalPath;

//       const inserted = await FileModel.create({
//         hash,
//         hashAlgo: "sha256",
//         objectKey: hash,
//         size: multerFile.size,
//         detectedMime,
//         refCount: 1,
//       });

//       meta = inserted._id;
//     } else {
//       await unlink(multerFile.path);
//       console.warn("Duplicate file unlinked...", multerFile.filename);

//       await FileModel.findOneAndUpdate(
//         { hash: exist.hash },
//         { $set: { refCount: exist.refCount + 1 } }
//       );

//       meta = exist._id;
//     }

//     userFileDoc.meta = meta;
//     const file = await UserFile.create(userFileDoc);

//     return res.status(201).json({ success:true, message: "File uploaded successfully.", file });
//   } catch (err) {
//     // Safe cleanup (ONLY local storage)
//     try {
//       if (multerFile?.path) {
//         await unlink(multerFile.path);
//         console.error("File unlinked...", multerFile.filename);
//       }
//     } catch (cleanupErr) {
//       console.error("Cleanup failed:", cleanupErr.message);
//     }

//     next(err);
//   }
// };

const handleGetFiles = async (req, res, next) => {
  const userId = req.user._id;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  const query = req.query || req.body; // type=video | type=audio, force=true

  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      userId,
      isDeleted: false,
    })
      .populate({ path: "meta", select: "objectKey detectedMime size" })
      .lean();

    if (!file) {
      return notFound(res, "File not found! Maybe it have got deleted.");
    }

    //_____________________METADATA___________________
    if (path.basename(req.path) === "metadata") {
      const metadata = getMetadata(file);
      return res.status(200).json({ success: true, metadata });
    }

    const absolutePath = path.join(UPLOAD_ROOT, file.meta.objectKey);

    res.setHeader("Accept-Ranges", "bytes");

    // Safety check: ensure inside upload root
    if (!absolutePath.startsWith(UPLOAD_ROOT) || !fs.existsSync(absolutePath))
      throw new Error("Error occured during execution!!");

    //preview
    if (
      file.disposition !== "inline" &&
      path.basename(req.path) === "preview"
    ) {
      if (
        (query.type === "video" || query.type === "audio") &&
        file.meta.detectedMime.startsWith(query.type) &&
        file.force_inline_preview &&
        query.force === "true"
      ) {
        file.disposition = "inline";
        file.meta.detectedMime = file.mimetype;
      } else return badRequest(res, "Not available for preview.");
    }

    const mime = file.meta.detectedMime || "application/octet-stream";
    const stat = fs.statSync(absolutePath);

    const disposition =
      path.basename(req.path) === "download" ? "attachment" : file.disposition;

    //video stream
    // if (mime.startsWith("video/")) {
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
      "Content-Type": mime,
      "Content-Disposition": `${disposition}; filename="${file.name}"`,
    });

    return fs.createReadStream(absolutePath).pipe(res);
    // }

    //download / serve
    // res.setHeader("Content-Type", mime);
    // res.setHeader(
    //   "Content-Disposition",
    //   `${disposition}; filename="${file.name}"`
    // );

    // res.status(200).setHeader("Content-Length", stat.size);
    // return fs.createReadStream(absolutePath).pipe(res);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

const handleUpdateFile = async (req, res, next) => {
  let { newname } = req.body;
  const parent = req.parentDir;

  const userId = req.user._id;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Please provide a valid id!");
  }

  const action = path.basename(req.path);

  try {
    const file = await UserFile.findOne({
      _id: new ObjectId(req.params.id),
      userId,
      isDeleted: false,
    })
      .populate({ path: "meta", select: "_id" })
      .lean();

    if (!file)
      return notFound(res, "File not found! May be it have got deleted.");

    /**********         COPY          **********/
    if (action === "copy") {
      const fileDoc = getFileDoc(file);

      fileDoc.name = `Copy-${file.name}`;
      fileDoc.parentId = parent?._id || null;
      fileDoc.meta = file.meta._id;

      const copied = await UserFile.insertOne(fileDoc);
      await FileModel.findOneAndUpdate(
        { _id: file.meta._id },
        { $inc: { refCount: 1 } }
      );

      return res.status(201).json({
        success: true,
        message: "Copied to target folder.",
        file: copied,
      });
    }

    /**********         MOVE          **********/
    if (action === "move") {
      if (
        (file.parentId === null && !parent) ||
        file.parentId?.toString() === parent?._id?.toString()
      ) {
        return badRequest(res, "File already in the target folder!");
      }

      const moved = await UserFile.findOneAndUpdate(
        { _id: file._id },
        { $set: { parentId: parent?._id || null, updatedAt: new Date() } }
      );

      return res.status(200).json({
        success: true,
        message: "Moved to target folder.",
        file: moved,
      });
    }

    /**********         RENAME          **********/
    if (!newname) return badRequest(res, "newname is required.");
    else {
      if (typeof newname !== "string") newname = String(newname);

      if (newname.length < 1 && action !== "move" && action !== "copy") {
        return badRequest(res, "Invalid name provided.");
      }

      const badNameStr = [".", "/", "\\", ":", "*", '"', "<", ">", "?", "|"];
      if (badNameStr.includes(newname[0])) {
        return badRequest(
          res,
          `newname cannot start with Invalid characters: . / \ : * " < > ? |`
        );
      }
    }
    // const currExt = path.extname(file.name);
    // const reqExt = path.extname(newname);
    // const reqName = newname.trim();

    // const finalName = currExt === reqExt
    //     ? reqName
    //     : `${path.basename(reqName, reqExt)}${currExt}`;

    const renamed = await UserFile.findOneAndUpdate(
      { _id: file._id },
      { $set: { name: newname, updatedAt: new Date() } },{new:true}
    );

    return res
      .status(200)
      .json({ success: true, message: "File renamed successfully." , file:renamed});
  } catch (err) {
    next(err);
  }
};

const handleMoveToBinFile = async (req, res, next) => {
  const userId = req.user._id;
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Please provide a valid id!");

  try {
    const file = await UserFile.findOne({
      _id: new ObjectId(req.params.id),
      userId: userId,
      isDeleted: false,
      deletedBy: "none",
    })
      .populate({ path: "meta", select: "objectKey detectedMime size" })
      .lean();

    if (!file)
      return badRequest(res, "file not found! May be it have got deleted.");

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
      { new: true }
    );

    return res
      .status(200)
      .json({ message: "File moved to bin succesfully.", data: op });
  } catch (err) {
    next(err);
  }
};

const handleRestoreFile = async (req, res, next) => {
  const userId = req.user._id;
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Please provide a valid id!");

  try {
    const file = await UserFile.findOne({
      _id: new ObjectId(req.params.id),
      userId: userId,
      isDeleted: true,
      deletedBy: "user",
    })
      .populate({ path: "meta", select: "objectKey detectedMime size" })
      .lean();

    if (!file) return notFound(res, "file not found!");

    const op = await restoreFile(userId, file);

    return res
      .status(200)
      .json({ message: "file restored successfully.", data: op });
  } catch (err) {
    next(err);
  }
};

const handleDeleteFile = async (req, res, next) => {
  const userId = req.user._id;
  const fileId = req.params.id;

  //invalid id check
  if (!ObjectId.isValid(fileId))
    return badRequest(res, "Please provide a valid id!");

  try {
    const file = await UserFile.findOne({ _id: new ObjectId(fileId), userId })
      .populate({ path: "meta", select: "objectKey" })
      .lean();

    if (!file) return notFound(res, "File not found!");

    const del = await UserFile.deleteOne({ _id: file._id });
    const updt = await FileModel.findOneAndUpdate(
      { _id: file.meta._id, refCount: { $gt: 0 } },
      { $inc: { refCount: -1 } },
      { new: true }
    );

    console.info({ del, updt });

    if (updt && updt.refCount <= 0) {
      //delete from db
      await FileModel.deleteOne({ _id: updt._id });

      //delete  from local
      const absolutePath = path.join(UPLOAD_ROOT, file.meta.objectKey);

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
      message: "File deletion successfull and no longer available.",
    });
  } catch (err) {
    next(err);
  }
};

export {
  handleGetFiles,
  handleUpdateFile,
  handleMoveToBinFile,
  handleRestoreFile,
  handleDeleteFile,
};
