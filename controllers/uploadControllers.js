import path from "node:path";
import { mkdir, rename, rm, unlink } from "node:fs/promises";

import { UploadSession } from "../models/uploadSession.model.js";
import { finalizeStorageRecord, mergeFileChunks } from "../utils/storage.js";
import { badRequest } from "../utils/helper.js";

const CHUNK_SIZE = {
  GUEST: 16 * 1024,
  USER: 1024 * 1024,
  ADMIN: 10 * 1024 * 1024,
  SUPER_ADMIN: 10 * 1024 * 1024,
};

const TMP_ROOT =
  process.env.TMP_ROOT || path.resolve(process.cwd() + "/uploads/temp");

export const initUpload = async (req, res, next) => {
  try {
    const { name, size, mime } = req.body;
    const userId = req.user._id;
    const parentId = req.parentDir._id;
    const chunkSize = CHUNK_SIZE[req.user.role];
    const strategy = size > chunkSize ? "chunked" : "direct";
    const totalChunks =
      strategy === "chunked" ? Math.ceil(size / chunkSize) : 1;

    const upload = await UploadSession.create({
      userId,
      parentId,
      fileName: name,
      size,
      mime,
      strategy,
      chunkSize,
      totalChunks,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });

    res.json({
      uploadId: upload._id,
      strategy,
      chunkSize: chunkSize,
      totalChunks,
    });
  } catch (err) {
    next(err);
  }
};

export const uploadChunk = async (req, res, next) => {
  try {
    const upload = req.uploadSession;
    const chunkIndex = Number(req.headers["x-chunk-index"]);
    const file = req.file;

    if (!file) return badRequest(res, "No chunk received.");

    const tempDir =
      upload.tempDir || path.join(TMP_ROOT, upload._id.toString());
    const updatedUpload = await UploadSession.findOneAndUpdate(
      { _id: upload._id, uploadedChunks: { $ne: chunkIndex } }, // Only if chunk isn't already there
      {
        $addToSet: { uploadedChunks: chunkIndex }, //prevents duplicate indices
        $set: { status: "uploading", tempDir },
      },
      { new: true },
    );

    if (!updatedUpload) {
      await unlink(file.path); // Clean up Multer temp file
      return res.json({ skipped: true, message: "Chunk already exists." });
    }

    const chunkPath = path.join(updatedUpload.tempDir, `chunk-${chunkIndex}`);
    await mkdir(updatedUpload.tempDir, { recursive: true });
    await rename(file.path, chunkPath);

    const progress = Math.round(
      (updatedUpload.uploadedChunks.length / updatedUpload.totalChunks) * 100,
    );

    return res.json({
      status: updatedUpload.status,
      progress: `${progress}%`,
      uploadedChunks: updatedUpload.uploadedChunks,
      totalChunks: updatedUpload.totalChunks,
      isComplete:
        updatedUpload.uploadedChunks.length === updatedUpload.totalChunks,
    });
  } catch (err) {
    // attempt safe cleanup
    try {
      if (file?.path) await unlink(file.path);
    } catch (cleanupErr) {
      // ignore cleanup errors
    }
    next(err);
  }
};

export const completeUpload = async (req, res, next) => {
  const upload = req.uploadSession;
  if (upload.uploadedChunks.length !== upload.totalChunks) {
    return res.status(400).json({ message: "Chunks missing." });
  }

  const mergedPath = path.join(TMP_ROOT, `${upload._id}-merged`);

  try {
    // 1. Optimized Merge via Streams
    await mergeFileChunks(upload, mergedPath);

    // 2. Finalize via Shared Service
    const userFile = await finalizeStorageRecord(upload, mergedPath);

    return res.status(201).json({ success: true, file: userFile });
  } catch (err) {
    upload.status = "failed";
    await upload.save();
    next(err);
  }
};

export const cancelUpload = async (req, res, next) => {
  const upload = req.uploadSession;

  try {
    if (upload.tempDir) {
      // Use rm recursive to delete the folder and all its chunks
      await rm(upload.tempDir, { recursive: true, force: true });
    }
    await UploadSession.deleteOne({ _id: upload._id });

    return res.status(200).json({ message: "Upload cancelled." });
  } catch (err) {
    next(err);
  }
};

export const getUploadStatus = async (req, res, next) => {
  try {
    const upload = req.uploadSession;

    const progress = Math.round(
      (upload.uploadedChunks.length / upload.totalChunks) * 100,
    );

    return res.json({
      status: upload.status,
      progress: `${progress}%`,
      uploadedChunks: upload.uploadedChunks,
      totalChunks: upload.totalChunks,
      isComplete: upload.uploadedChunks.length === upload.totalChunks,
    });
  } catch (err) {
    next(err);
  }
};
