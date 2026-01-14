import path from "path";
import { unlink, copyFile } from "node:fs/promises";
import { Db, ObjectId } from "mongodb";

import { fileTypeFromFile } from "file-type";

import {
  INLINE_MIME,
  INLINE_MIME_AUDIO_VIDEO_EXT,
} from "../configs/mimeSet.js";

import { restoreFile } from "../utils/restore.js";
import {
  badRequest,
  notFound,
  getFileDocHelper,
  getMetadataHelper,
} from "../utils/helper.js";

import FileModel from "../models/file.model.js";

//env variables
const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

//API Handlers

const handleCreateFile = async (req, res, next) => {
  const parent = req.parentDir;
  const multerFile = req.file;
  const userId = req.user._id;

  if (!multerFile) {
    return badRequest(res, "No file in the request!!");
  }

  if (multerFile.size === 0) {
    await unlink(multerFile.path);
    return badRequest(res, "Empty file upload is not allowed!!");
  }

  try {
    const detected = await fileTypeFromFile(multerFile.path);
    const detectedMime = detected?.mime || "application/octet-stream";

    const disposition = INLINE_MIME.has(detectedMime) ? "inline" : "attachment";

    const fileDoc = getFileDocHelper(multerFile);

    fileDoc.userId = userId;
    fileDoc.parentId = parent?._id || null;
    fileDoc.detectedMime = detectedMime;
    fileDoc.disposition = disposition;

    /*  handle same name files  */

    // const sameFiles = await FileModel.find({
    //   originalname: fileDoc.originalname,
    //   userId: userId,
    //   parentId: fileDoc.parentId,
    // }).lean();

    // if (sameFiles.length > 0){
    //   const ext = path.extname(fileDoc.originalname);
    //   fileDoc.originalname = fileDoc.originalname.replace(`${ext}`, `(${sameFiles.length})`)+ `${ext}`
    // }

    const file = await FileModel.insertOne(fileDoc);

    return res.status(201).json({
      message: "File uploaded successfully.",
      data: file._id,
    });
  } catch (err) {
    // Safe cleanup (ONLY local storage)
    try {
      if (multerFile?.path) {
        await unlink(multerFile.path);
        console.error("File unlinked...", multerFile.filename);
      }
    } catch (cleanupErr) {
      console.error("Cleanup failed:", cleanupErr.message);
    }

    next(err);
  }
};

const handleGetFiles = async (req, res, next) => {
  const userId = req.user._id;
  if (!ObjectId.isValid(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  const queries = req.query; // type=video | type=audio, prev=yes

  try {
    const file = await FileModel.findOne({
      _id: new ObjectId(req.params.id),
      userId,
      isDeleted: false,
    });

    if (!file) {
      return notFound(res, "File not found! Maybe it have got deleted.");
    }

    // if (file.cdnUrl) {
    //   return res.redirect(file.cdnUrl);
    // }

    if (path.basename(req.path) === "metadata") {
      const metadata = getMetadataHelper(file);

      return res.status(200).json({ success: true, metadata });
    }

    const absolutePath = path.join(path.resolve(UPLOAD_ROOT), file.objectKey);

    res.setHeader("Accept-Ranges", "bytes");

    // Safety check: ensure inside upload root
    if (
      !absolutePath.startsWith(path.resolve(UPLOAD_ROOT)) ||
      !fs.existsSync(absolutePath)
    ) {
      console.log(
        "Error: ",
        "Invalid path / file not exists in local ",
        !absolutePath.startsWith(path.resolve(UPLOAD_ROOT)),
        !fs.existsSync(absolutePath)
      );
      return next("Error occured during execution!!");
    }

    const ext = path.extname(file.originalname).replace(".", "");

    if (
      file.disposition !== "inline" &&
      path.basename(req.path) === "preview"
    ) {
      if (
        (queries.type === "video" || queries.type === "audio") &&
        file.detectedMime.startsWith(queries.type) &&
        queries.prev === "yes" &&
        INLINE_MIME_AUDIO_VIDEO_EXT.has(ext)
      ) {
        file.disposition = "inline";
        file.detectedMime = INLINE_MIME_AUDIO_VIDEO_EXT.has(ext)
          ? `video/${ext}`
          : file.mime;
      } else
        return badRequest(
          res,
          "Sorry! Requested file is not available for preview."
        );
    }

    const mime = file.detectedMime || "application/octet-stream";
    const stat = fs.statSync(absolutePath);

    const disposition =
      path.basename(req.path) === "download" ? "attachment" : file.disposition;

    //video
    if (mime.startsWith("video/")) {
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
        "Content-Disposition": `${disposition}; filename="${file.originalname}"`,
      });

      return fs.createReadStream(absolutePath).pipe(res);
    }

    res.setHeader("Content-Type", mime);
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${file.originalname}"`
    );

    res.status(200).setHeader("Content-Length", stat.size);
    return fs.createReadStream(absolutePath).pipe(res);
  } catch (err) {
    console.log(err);
    next(err);
  }
};

const handleUpdateFile = async (req, res, next) => {
  let { newname } = req.body;
  const parent = req.parentDir;

  const userId = req.user._id;
  if (!ObjectId.isValid(req.params.id)) {
    return badRequest(res, "Please provide a valid id!");
  }

  const action = path.basename(req.path);

  try {
    const file = await FileModel.findOne({
      _id: new ObjectId(req.params.id),
      userId: userId,
      isDeleted: false,
    }).lean();

    if (!file)
      return notFound(res, "File not found! May be it have got deleted.");

    /**********         COPY          **********/
    if (action === "copy") {
      const fileDoc = getFileDocHelper(file);

      fileDoc.originalname = `Copy-${file.originalname}`;
      fileDoc.parentId = parent?._id || null;
      fileDoc.filename = `${crypto.randomUUID()}`;
      fileDoc.objectKey = fileDoc.filename;

      await copyFile(
        path.join(UPLOAD_ROOT, file.objectKey),
        path.join(UPLOAD_ROOT, fileDoc.objectKey)
      );

      const created = await FileModel.insertOne(fileDoc);

      return res.status(201).json({
        success: true,
        message: "Copied successfully.",
        data: created.insertedId,
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

      await FileModel.updateOne(
        { _id: file._id },
        { $set: { parentId: parent?._id || null, updatedAt: new Date() } }
      );

      return res.status(200).json({
        success: true,
        message: "Moved successfully.",
      });
    }

    /**********         RENAME          **********/
    if (!newname) return badRequest(res, "newname is required.");
    else {
      if (typeof newname !== "string") newname = String(newname);

      if (newname.length < 1 && action !== "move" && action !== "copy") {
        return badRequest(res, "Invalid name provided.");
      }

      if (newname.startsWith(".")) {
        return badRequest(res, "newname cannot start with dot (.)");
      }
    }
    const currExt = path.extname(file.originalname);
    const reqExt = path.extname(newname);
    const reqName = newname.trim();

    const finalName =
      currExt === reqExt
        ? reqName
        : `${path.basename(reqName, reqExt)}${currExt}`;

    await FileModel.updateOne(
      { _id: file._id },
      { $set: { originalname: finalName, updatedAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: "File renamed successfully.",
    });
  } catch (err) {
    next(err);
  }
};

const handleMoveToBinFile = async (req, res, next) => {
  const userId = req.user._id;
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "Please provide a valid id!");

  try {
    const file = await FileModel.findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: false,
        deletedBy: "",
      },
      { _id: 1 }
    ).lean();

    if (!file)
      return badRequest(res, "file not found! May be it have got deleted.");

    const op = await FileModel.updateOne(
      { _id: file._id },
      {
        $set: {
          isDeleted: true,
          updatedAt: new Date(),
          deletedAt: new Date(),
          deletedBy: "user",
        },
      }
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
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "Please provide a valid id!");

  try {
    const file = await FileModel.findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: true,
        deletedBy: "user",
      },
      { _id: 1, originalname: 1, parentId: 1, parentName: 1 }
    );

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
    const file = await FileModel.findOne({ _id: new ObjectId(fileId), userId });

    if (!file) return notFound(res, "File not found!");

    const absolutePath = path.join(path.resolve(UPLOAD_ROOT), file.objectKey);

    if (!absolutePath.startsWith(path.resolve(UPLOAD_ROOT))) {
      console.log(
        "Error: ",
        "Invalid path / file not exists in local ",
        !absolutePath.startsWith(path.resolve(UPLOAD_ROOT))
      );
      return next("Error occured during execution!!");
    }

    await FileModel.deleteOne({ _id: file._id });

    try {
      await unlink(absolutePath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
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
  handleCreateFile,
  handleUpdateFile,
  handleMoveToBinFile,
  handleRestoreFile,
  handleDeleteFile,
};
