import mongoose from "mongoose";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, unlink } from "node:fs/promises";

import { UploadSession } from "../models/uploadSession.model.js";
import { File as FileModel } from "../models/file.model.js";
import { uploadInitSchema } from "../Schemas/userSchema.js";

import { finalizeStorageRecord, mergeFileChunks } from "../utils/storage.js";
import {  getErrorObject } from "../utils/helper.js";
import { TIME, CHUNK_SIZE, TEMP_ROOT, UPLOAD_ROOT } from "../misc/constants.js";

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
    const { success, data, error } = uploadInitSchema.safeParse(req.body);
    if (!success) {
      const errorMessage = error.issues.map((err) => err.message).join(", ");
      return next(getErrorObject(errorMessage));
    }

    const { name, size, mime } = data;
    const { _id, allotedStorage, usedStorage } = req.parent.userId;

    if (allotedStorage - usedStorage < size)
      return next(getErrorObject("Storage limit exceeded"));

    const { role } = req.user;
    const strategy = size > CHUNK_SIZE[role] ? "chunked" : "direct";
    const chunkSize = strategy === "chunked" ? CHUNK_SIZE[role] : size;
    const totalChunks =
      strategy === "chunked" ? Math.ceil(size / chunkSize) : 1;

    const upload = await UploadSession.create({
      userId: _id,
      parentId: req.parent._id,
      filename: name,
      size,
      mime,
      strategy,
      chunkSize,
      totalChunks,
      expiresAt: new Date(Date.now() + TIME.ONE_DAY),
    });

    // res.setHeader("x-chunk-index", 0);
    res.status(200).json({
      success: true,
      message: "Upload record created.",
      data: {
        uploadId: upload._id,
        strategy,
        expectedChunkSize: chunkSize,
        totalChunks,
      },
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
export const saveChunk = async (req, res, next) => {
  try {
    const { _id, tempDir, uploadedChunks, totalChunks, chunkSize } =
      req.uploadSession;
    const chunkIndex = Number(req.headers["x-chunk-index"]);
    if (
      chunkIndex === undefined ||
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0
    )
      return next(getErrorObject("Wrong chunk indexing."));

    const file = req.file;
    if (!file || file.size === 0 || !file.path)
      return next(getErrorObject("No chunk received."));

    const filePath = path.resolve(file.path);
    let error = null;
    if (totalChunks === uploadedChunks.length) {
      error = { status: 409, message: "All chunks are already uploaded." };
    } else if (uploadedChunks.includes(chunkIndex)) {
      error = { status: 409, message: "Chunk already exists." };
    } else if (uploadedChunks.length !== chunkIndex) {
      error = {
        status: 403,
        message: "Wrong indexed file. Index should always be continuous.",
      };
    } else if (file.size > chunkSize) {
      error = { status: 403, message: "Chunk size not matched." };
    }

    if (error) {
      if (filePath && existsSync(filePath)) await unlink(filePath);
      return next(getErrorObject(error.message, error.status));
    }

    const status =
      totalChunks === uploadedChunks.length + 1 ? "uploaded" : "uploading";
    const td = path.resolve(TEMP_ROOT, _id.toString());

    if (!td.startsWith(path.resolve(TEMP_ROOT) + path.sep))
      return next(getErrorObject("Invalid session path."));

    const chunkPath = path.resolve(td, `chunk-${chunkIndex}`);
    if (!chunkPath.startsWith(td + path.sep))
      return next(getErrorObject("Invalid chunk path."));

    const uq = {
      $addToSet: { uploadedChunks: chunkIndex }, //prevents duplicate indices
      $set: { status, tempDir: td },
    };
    if (chunkIndex == 0) {
      const detected = await fileTypeFromFile(filePath);
      uq.$set.mime = detected?.mime || "application/octet-stream";
    }

    const updatedUpload = await UploadSession.findByIdAndUpdate(_id, uq, {
      returnDocument: "after",
    })
      .select("uploadedChunks")
      .lean();

    await mkdir(td, { recursive: true });
    await rename(filePath, chunkPath);

    const progress = Math.round(
      (updatedUpload.uploadedChunks.length / totalChunks) * 100,
    );

    return res.status(200).json({
      success: true,
      message: "chunk uploaded.",
      data: {
        status,
        progress,
        isCompleted: progress < 100 ? true : false,
      },
    });
  } catch (err) {
    try {
      if (file?.path) await unlink(path.resolve(file.path));
    } catch (cErr) {}

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
  const { _id, uploadedChunks, totalChunks, parentId } = upload;

  if (uploadedChunks.length !== totalChunks)
    return next(getErrorObject("Chunks missing."));

  const mergedPath = path.resolve(TEMP_ROOT, `${_id.toString()}-merged`);
  const tempDir = path.resolve(TEMP_ROOT, _id.toString());

  try {
    // 1. Optimized Merge via Streams
    const hash = await mergeFileChunks(uploadedChunks, tempDir, mergedPath);

    //2. Pre-Process
    // const detected = await fileTypeFromFile(mergedPath);
    const detectedMime = upload.mime || "application/octet-stream";

    const existingRecord = await FileModel.findOne({ hash })
      .select("_id refCount")
      .lean();

    // 3. Finalize via Shared Service
    const file = await finalizeStorageRecord({
      upload,
      hash,
      existingRecord,
      detectedMime,
      status: "uploaded",
    });

    //4. Post-Process (storage manage)
    if (file) {
      await mkdir(path.resolve(UPLOAD_ROOT, parentId.userId.toString()), {
        recursive: true,
      });

      const finalPath = path.resolve(
        UPLOAD_ROOT,
        parentId.userId.toString(),
        hash,
      );

      if (existingRecord) {
        await unlink(mergedPath);
      } else {
        rename(mergedPath, finalPath).catch((err) =>
          console.error("rename failed:", err),
        );
      }

      if (tempDir)
        rm(tempDir, { recursive: true, force: true }).catch((err) =>
          console.error("cleanup failed:", err),
        );
    }

    return res
      .status(201)
      .json({ success: true, message: "File uploaded.", data: { file } });
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
  const { _id, strategy, filename } = req.uploadSession;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await UploadSession.updateOne(
        { _id },
        {
          status: "cancelled",
          expiresAt: new Date(Date.now() + TIME.ONE_MINUTE),
        },
      ).session(session);
    });
    const tempDir =
      strategy === "google-drive"
        ? path.resolve(TEMP_ROOT, `google_${req.user._id.toString()}`)
        : path.resolve(TEMP_ROOT, _id.toString());
    if (tempDir && strategy !== "google-drive") {
      rm(tempDir, { recursive: true, force: true }).catch((err) =>
        console.error("cleanup failed:", err),
      );
    } else {
      const filePath = path.resolve(tempDir, filename);
      if (existsSync(filePath))
        unlink(filePath).catch((err) => console.error("cleanup failed:", err));
    }

    return res.status(200).json({
      success: true,
      message: "Upload cancelled.",
      data: {
        _id,
        filename,
      },
    });
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
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
    const { status, uploadedChunks, totalChunks, strategy, size, bytesRead } =
      req.uploadSession;
    const isCompleted = status === "uploaded" || status === "imported";
    const progress = isCompleted
      ? 100
      : strategy === "google-drive"
        ? Math.round((bytesRead / size) * 100) || 0
        : Math.round((uploadedChunks.length / totalChunks) * 100);

    return res
      .status(200)
      .json({ success: true, data: { status, progress, isCompleted } });
  } catch (err) {
    next(err);
  }
};
