import fs from "node:fs";
import path from "path";
import { unlink } from "node:fs/promises";
import { Db, ObjectId } from "mongodb";

import { fileTypeFromFile } from "file-type";

import {
  INLINE_MIME,
  INLINE_MIME_AUDIO_VIDEO_EXT,
} from "../configs/mimeSet.js";

import { restoreFile } from "../utils/restore.js";

//env variables
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.resolve(process.cwd() +"/uploads");

/* helper Functions */
const badRequest = (res, message) =>
  res.status(400).json({ success: false, message: message });

const notFound = (res, message) =>
  res.status(404).json({ success: false, message: message });

const getMetadata = (file) => {
  if (!file) return {};
  const metadata = {
    id: file._id,
    parentId: file.parentId,
    name: file.originalname,
    mime: file.detectedMime,
    size: file.size,
    isDeleted: file.isDeleted,
    deletedBy: file.deletedBy,
    deletedAt: file.deletedAt,
    createdAt: file.createdAt,
    modifiedAt: file.modifiedAt,
  };
  return metadata;
};

//API Handlers

const handleCreateFile = async (req, res, next) => {
  const db = req.db;
  const parent = req.parentDir;
  const multerFile = req.file;
  const userId = req.user._id;
  // const externalView = req.body.viewPermission;

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

    const fileDoc = {
      userId,

      parentId: parent?._id || null,

      originalname: multerFile.originalname,
      filename: multerFile.filename,

      // storage abstraction
      storageProvider: "local",
      objectKey: multerFile.filename, // NOT path

      mimetype: multerFile.mimetype, // informational only
      detectedMime,

      disposition,

      size: multerFile.size,

      isDeleted: false,
      deletedBy: "",
      deletedAt: null,

      createdAt: new Date(),
      modifiedAt: new Date(),
    };

    const { insertedId } = await db.collection("files").insertOne(fileDoc);

    return res.status(201).json({
      message: "File uploaded successfully.",
      data: insertedId,
    });
  } catch (err) {
    // Safe cleanup (ONLY local storage)
    try {
      if (multerFile?.path) {
        await unlink(multerFile.path);
      }
    } catch (cleanupErr) {
      console.error("Cleanup failed:", cleanupErr.message);
    }

    next(err);
  }
};

const handleGetFiles = async (req, res, next) => {
  const db = req.db;
  const userId = req.user._id;
  const queries = req.query; //t=type, vid=video, fp=forcePreview, y=yes

  if (!ObjectId.isValid(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  try {
    const file = await db.collection("files").findOne({
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
      const metadata = getMetadata(file);
      return res
        .status(200)
        .json({ message: "File metadata found.", metadata: metadata });
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
        (queries.t === "vid" || queries.t === "aud") &&
        file.detectedMime.startsWith(queries.t) &&
        queries.fp === "y" &&
        INLINE_MIME_AUDIO_VIDEO_EXT.has(ext)
      ) {
        file.disposition = "inline";
        file.detectedMime = INLINE_MIME_AUDIO_VIDEO_EXT.has(ext)
          ? `video/${ext}`
          : file.mime;
      } else return badRequest(res, "File is not available for preview.");
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
  const { newname } = req.body;
  const db = req.db;
  const userId = req.user._id;

  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "Please provide a valid id!!");

  if (!newname) return badRequest(res, "newname not found in the request!!");

  try {
    //changing filename if exists in filesDb
    const file = await db.collection("files").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: false,
      },
      {
        projection: {
          _id: 1,
          originalname: 1,
        },
      }
    );
    if (!file)
      return notFound(res, "File not found! May be it have got deleted.");

    const currExt = path.extname(file.originalname);
    const reqExt = path.extname(newname);

    const finalName =
      currExt === reqExt
        ? newname
        : `${path.basename(newname, reqExt)}${currExt}`;

    const update = await db.collection("files").updateOne(
      { _id: file._id },
      {
        $set: { originalname: finalName, modifiedAt: new Date() },
      }
    );

    return res
      .status(200)
      .json({ message: "File renamed successfully.", data: update });
  } catch (err) {
    return next(err);
  }
};

const handleMoveToBinFile = async (req, res, next) => {
  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "Please provide a valid id!!");

  const db = req.db;
  const userId = req.user._id;

  try {
    const file = await db.collection("files").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: false,
        deletedBy: "",
      },
      { projection: { _id: 1 } }
    );

    if (!file)
      return badRequest(res, "file not found! May be it have got deleted.");

    const op = await db.collection("files").updateOne(
      { _id: file._id },
      {
        $set: {
          isDeleted: true,
          modifiedAt: new Date(),
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
  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "Please provide a valid id!!");

  const db = req.db;
  const userId = req.user._id;

  try {
    const file = await db.collection("files").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: true,
        deletedBy: "user",
      },
      { projection: { _id: 1, originalname: 1, parentId: 1, parentName: 1 } }
    );

    if (!file) return notFound(res, "file not found!");

    const op = await restoreFile(db, userId, file);

    return res
      .status(200)
      .json({ message: "file restored successfully.", data: op });
  } catch (err) {
    next(err);
  }
};

const handleDeleteFile = async (req, res, next) => {
  const db = req.db;
  const userId = req.user._id;
  const fileId = req.params.id;

  //invalid id check
  if (!ObjectId.isValid(fileId))
    return badRequest(res, "Please provide a valid id!!");

  try {
    const file = await db
      .collection("files")
      .findOne({ _id: new ObjectId(fileId), userId });
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

    await db.collection("files").deleteOne({ _id: file._id });

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
