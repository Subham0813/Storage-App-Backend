import path from "node:path";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, unlink } from "node:fs/promises";

import { fileTypeFromFile } from "file-type";
import { INLINE_MIME } from "../configs/mimeSet.js";
import { getFileHash } from "../utils/helper.js";

import { File as FileModel } from "../models/file.model.js";
import { UserFile } from "../models/user_file.model.js";
import { UploadSession } from "../models/uploadSession.model.js";

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");
const TMP_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads/temp");

export const initUpload = async (req, res) => {
  const { name, size, mime } = req.body;
  const userId = req.user._id;
  const parent = req.parentDir;

  const strategy = size > CHUNK_SIZE ? "chunked" : "direct";

  const totalChunks = strategy === "chunked" ? Math.ceil(size / CHUNK_SIZE) : 1;

  const upload = await UploadSession.create({
    userId,
    fileName: name,
    size,
    mime,
    parentId: parent?._id || null,
    strategy,
    chunkSize: CHUNK_SIZE,
    totalChunks,
    expiresAt: new Date(Date.now() + 3600 * 1000),
  });

  res.json({
    uploadId: upload._id,
    strategy,
    chunkSize: CHUNK_SIZE,
    totalChunks,
  });
};

export const uploadChunk = async (req, res, next) => {
  // console.log("headers:", req.headers["content-type"]);

  const upload = req.uploadSession;
  const chunkIndex = Number(req.headers["x-chunk-index"]);

  
  const file = req.file;
  
  if (!file) {
    return res.status(400).json({ message: "No chunk received" });
  }
  
  if (upload.status === "cancelled") {
    await unlink(file.path);
    return res.status(410).json({ message: "Upload was cancelled" });
  }
  
  if (upload.uploadedChunks.includes(chunkIndex)) {
    await unlink(file.path);
    return res.json({ skipped: true });
  }

  const tempDir = upload.tempDir || path.join(TMP_ROOT, upload._id.toString());

  await mkdir(tempDir, { recursive: true });

  const chunkPath = path.join(tempDir, `chunk-${chunkIndex}`);

  await rename(file.path, chunkPath);

  upload.tempDir = tempDir;
  upload.status = "uploading";
  upload.uploadedChunks.push(chunkIndex);
  await upload.save();

  return res.json({
    success: true,
    uploadedChunks: upload.uploadedChunks.length,
  });
};

export const completeUpload = async (req, res, next) => {
  const upload = req.uploadSession;

  if (upload.uploadedChunks.length !== upload.totalChunks) {
    return res.status(400).json({
      message: "All chunks not uploaded yet",
    });
  }

  const mergedPath = path.join(TMP_ROOT, `${upload._id}-merged`);

  try {
    // 1. MERGE LOGIC
    const writeStream = createWriteStream(mergedPath);

    for (let i = 0; i < upload.totalChunks; i++) {
      const chunkPath = path.join(upload.tempDir, `chunk-${i}`);
      const data = await readFile(chunkPath);
      writeStream.write(data);
    }

    writeStream.end();
    await new Promise((r) => writeStream.on("finish", r));

    // 2. DEDUPE LOGIC
    const detected = await fileTypeFromFile(mergedPath);
    const detectedMime = detected?.mime || "application/octet-stream";

    const disposition = INLINE_MIME.has(detectedMime) ? "inline" : "attachment";

    const hash = await getFileHash(mergedPath, "sha256", "base64url");
    const finalPath = path.join(UPLOAD_ROOT, hash);

    let meta;
    const exist = await FileModel.findOne({ hash, userId: upload.userId });

    if (!exist) {
      await rename(mergedPath, finalPath);

      const newFile = await FileModel.create({
        userId: upload.userId,
        hash,
        hashAlgo: "sha256",
        objectKey: hash,
        size: upload.size,
        detectedMime,
        refCount: 1,
      });

      meta = newFile._id;
    } else {
      await unlink(mergedPath);
      exist.refCount += 1;
      meta = exist._id;
      await exist.save();
    }

    const userFile = await UserFile.create({
      name: upload.fileName,
      userId: upload.userId,
      parentId: upload.parentId,
      disposition,
      mimetype: upload.mime,
      inline_preview: disposition === "inline",
      force_inline_preview: INLINE_MIME.has(upload.mime),
      meta,
    });

    upload.status = "completed";
    await upload.save();

    if (upload.tempDir) {
      await rm(upload.tempDir, { recursive: true, force: true });
    }

    await UploadSession.deleteOne({ _id: upload._id, status: "completed" }); //deleting uploadSession if upload completed

    return res.status(201).json({
      success: true,
      file: userFile,
    });
  } catch (err) {
    upload.status = "failed";
    await upload.save();

    if (upload.tempDir) {
      await rm(upload.tempDir, { recursive: true, force: true });
    }

    throw err;
  }
};

export const getUploadStatus = async (req, res) => {
  const upload = req.uploadSession;

  return res.json({
    status: upload.status,
    uploadedChunks: upload.uploadedChunks,
    totalChunks: upload.totalChunks,
  });
};
