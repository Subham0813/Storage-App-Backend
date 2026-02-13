import path from "node:path";
import { mkdir, rename, rm, unlink } from "node:fs/promises";

import { UploadSession } from "../models/uploadSession.model.js";
import { finalizeStorageRecord, mergeFileChunks } from "../utils/storage.js";
import { User } from "../models/user.model.js";
import { badRequest } from "../utils/helper.js";

const CHUNK_SIZE = {
  GUEST: 16 * 1024,
  USER: 1024 * 1024,
  ADMIN: 10 * 1024 * 1024,
  SUPER_ADMIN: 10 * 1024 * 1024,
};

const TMP_ROOT =
  process.env.TMP_ROOT || path.resolve(process.cwd() + "/uploads/temp");

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

/**
 * path: /api/uploads/session/create
 * what it do: Initialize a new upload session, validating file size and storage quota, determining chunk strategy.
 * requirements:
 *   - req.body: { name: string, size: number, mime: string }
 *   - req.user: authenticated user object provided by `validateSession`
 *   - req.parentDir: directory object provided by `loadParentDirectory` middleware
 */
export const initUpload = async (req, res, next) => {
  try {
    const { name, size, mime } = req.body;
    const owner = await User.findById(req.parent.userId);

    const storageLeft = owner.allotedStorage - owner.usedStorage;
    if (storageLeft < size)
      return res.status(400).json({
        success: false,
        message: `Insufficient storage for the file : ${name}`,
        error: "MAX_STORAGE_LIMIT_REACHED",
      });

    const { _id: userId, role } = req.user;
    const chunkSize = CHUNK_SIZE[role];
    const strategy = size > chunkSize ? "chunked" : "direct";
    const totalChunks =
      strategy === "chunked" ? Math.ceil(size / chunkSize) : 1;

    const upload = await UploadSession.create({
      userId,
      parentId: req.parent._id,
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

/**
 * path: /api/uploads/session/:sessionId/chunk
 * what it do: Receive a single chunk of an upload, rename and store in session temp directory, track uploaded chunks.
 * requirements:
 *   - req.params: { sessionId: string }
 *   - req.headers: { x-chunk-index: number }
 *   - req.file: multipart form file from upload middleware
 *   - req.uploadSession: upload session object provided by `loadUploadSession` middleware
 */
export const uploadChunk = async (req, res, next) => {
  try {
    const { _id: uid, tempDir } = req.uploadSession;
    const chunkIndex = Number(req.headers["x-chunk-index"]);
    const file = req.file;

    if (!file) return badRequest(res, "No chunk received.");

    const td = tempDir || path.join(TMP_ROOT, uid.toString());

    const updatedUpload = await UploadSession.findOneAndUpdate(
      { _id: uid, uploadedChunks: { $ne: chunkIndex } }, // Only if chunk isn't already there
      {
        $addToSet: { uploadedChunks: chunkIndex }, //prevents duplicate indices
        $set: { status: "uploading", td },
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

    return res.status(200).json({
      success: true,
      message: "chunk uploaded.",
      data: {
        status: upload.status,
        progress: `${progress}%`,
        uploadedChunks: upload.uploadedChunks,
        totalChunks: upload.totalChunks,
        isComplete: upload.uploadedChunks.length === upload.totalChunks,
      },
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

/**
 * path: /api/uploads/session/:sessionId/complete
 * what it do: Verify all chunks uploaded, merge chunks into final file, finalize storage record, deduplicate via hashing.
 * requirements:
 *   - req.params: { sessionId: string }
 *   - req.uploadSession: upload session object provided by `loadUploadSession` middleware
 *   - All chunks must be uploaded (uploadedChunks.length === totalChunks)
 */
export const completeUpload = async (req, res, next) => {
  const upload = req.uploadSession;
  const { _id: uid, uploadedChunks, totalChunks, parentId, tempDir } = upload;

  if (uploadedChunks.length !== totalChunks) {
    return res.status(400).json({ message: "Chunks missing." });
  }

  const mergedPath = path.join(TMP_ROOT, `${uid.toString()}-merged`);

  try {
    // 1. Optimized Merge via Streams
    const hash = await mergeFileChunks(upload, mergedPath);

    //2. Pre-Process
    const detected = await fileTypeFromFile(mergedPath);
    const detectedMime =
      detected?.mime || upload.mime || "application/octet-stream";

    const finalPath = path.join(UPLOAD_ROOT, parentId.userId.toString(), hash);
    const exist = await FileModel.findOne({ hash }).select("_id refCount");

    await mkdir(path.join(UPLOAD_ROOT, parentId.userId.toString()), {
      recursive: true,
    });

    if (exist) await unlink(mergedPath);
    else await rename(mergedPath, finalPath);

    if (tempDir)
      rm(tempDir, { recursive: true, force: true }).catch((err) =>
        console.error("cleanup failed:", err),
      );

    // 3. Finalize via Shared Service
    const userFile = await finalizeStorageRecord({
      upload,
      hash,
      exist,
      detectedMime,
      status: "uploaded",
    });

    return res.status(201).json({ success: true, file: userFile });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/uploads/session/:sessionId/cancel
 * what it do: Delete the upload session and clean up temporary chunks directory.
 * requirements:
 *   - req.params: { sessionId: string }
 *   - req.uploadSession: upload session object provided by `loadUploadSession` middleware
 */
export const cancelUpload = async (req, res, next) => {
  const upload = req.uploadSession;

  try {
    await UploadSession.deleteOne({ _id: upload._id });

    if (upload.tempDir) {
      // Use rm recursive to delete the folder and all its chunks
      rm(upload.tempDir, { recursive: true, force: true }).catch((err) =>
        console.error("cleanup failed:", err),
      );
    }

    return res.status(200).json({ message: "Upload cancelled." });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/uploads/session/:sessionId
 * what it do: Return current upload progress, uploaded chunk indices, and completion status.
 * requirements:
 *   - req.params: { sessionId: string }
 *   - req.uploadSession: upload session object provided by `loadUploadSession` middleware
 */
export const getUploadStatus = async (req, res, next) => {
  try {
    const upload = req.uploadSession;

    const progress = Math.round(
      (upload.uploadedChunks.length / upload.totalChunks) * 100,
    );

    return res.json({
      success: true,
      data: {
        status: upload.status,
        progress: `${progress}%`,
        uploadedChunks: upload.uploadedChunks,
        totalChunks: upload.totalChunks,
        isComplete: upload.uploadedChunks.length === upload.totalChunks,
      },
    });
  } catch (err) {
    next(err);
  }
};
