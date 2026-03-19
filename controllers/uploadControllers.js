import path from "node:path";
import { mkdir, rename, rm, unlink } from "node:fs/promises";

import { UploadSession } from "../models/uploadSession.model.js";
import { File as FileModel } from "../models/file.model.js";
import { User } from "../models/user.model.js";
import { finalizeStorageRecord, mergeFileChunks } from "../utils/storage.js";
import { badRequest } from "../utils/helper.js";
import { fileTypeFromFile } from "file-type";
import mongoose from "mongoose";
import { TIME, CHUNK_SIZE, TEMP_ROOT, UPLOAD_ROOT} from "../misc/constants.js";

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
    const { allotedStorage, usedStorage } = await User.findById(
      req.parent.userId,
    )
      .select("allotedStorage usedStorage")
      .lean();

    const parsedSize = parseInt(size);
    const remaining = allotedStorage - usedStorage;
    if (remaining < parsedSize)
      return res.status(400).json({
        success: false,
        message: `Insufficient storage for the file : ${name}`,
        error: "MAX_STORAGE_LIMIT_REACHED",
      });

    const { _id: userId, role } = req.user;
    const strategy = parsedSize > CHUNK_SIZE[role] ? "chunked" : "direct";
    const chunkSize = strategy === "chunked" ? CHUNK_SIZE[role] : parsedSize;
    const totalChunks =
      strategy === "chunked" ? Math.ceil(parsedSize / chunkSize) : 1;

    const upload = await UploadSession.create({
      userId,
      parentId: req.parent._id,
      filename: name,
      size: parsedSize,
      mime,
      strategy,
      chunkSize,
      totalChunks,
      expiresAt: new Date(Date.now() + TIME.ONE_DAY),
    });

    // res.setHeader("x-chunk-index", 0);
    res.status(200).json({
      uploadId: upload._id,
      strategy,
      expectedChunkSize: chunkSize,
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
      return badRequest(res, "Wrong chunk indexing.");

    const file = req.file;
    if (!file || file.size === 0) return badRequest(res, "No chunk received.");

    let error = null;

    if (chunkIndex == 0) {
      const detected = await fileTypeFromFile(file.path);
      if (detected && detected.mime !== req.uploadSession.mime) {
        error = { status: 403, message: "Chunk MIME type mismatch." };
      }
    } else if (totalChunks === uploadedChunks.length) {
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
      if (file?.path) await unlink(file.path);
      return res.status(error.status).json({ message: error.message });
    }

    const status =
      totalChunks === uploadedChunks.length + 1 ? "uploaded" : "uploading";
    const td = tempDir || path.join(TEMP_ROOT, _id.toString());

    const updatedUpload = await UploadSession.findByIdAndUpdate(
      _id,
      {
        $addToSet: { uploadedChunks: chunkIndex }, //prevents duplicate indices
        $set: { status, tempDir: td },
      },
      { new: true },
    )
      .select("uploadedChunks")
      .lean();

    await mkdir(td, { recursive: true });

    const chunkPath = path.join(td, `chunk-${chunkIndex}`);
    await rename(file.path, chunkPath);

    const progress = Math.round(
      (updatedUpload.uploadedChunks.length / totalChunks) * 100,
    );

    // if (status !== "uploaded") res.setHeader("x-chunk-index", chunkIndex + 1);
    return res.status(200).json({
      success: true,
      message: "chunk uploaded.",
      data: {
        status,
        progress,
        isCompleted: updatedUpload.uploadedChunks.length === totalChunks,
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
  const { _id, uploadedChunks, totalChunks, parentId, tempDir } = upload;

  if (uploadedChunks.length !== totalChunks) {
    return res.status(400).json({ message: "Chunks missing." });
  }
  const mergedPath = path.join(
    TEMP_ROOT,
    `${_id.toString()}-merged`,
  );

  try {
    // 1. Optimized Merge via Streams
    const hash = await mergeFileChunks(uploadedChunks, tempDir, mergedPath);

    //2. Pre-Process
    const detected = await fileTypeFromFile(mergedPath);
    const detectedMime =
      detected?.mime || upload.mime || "application/octet-stream";

    const existingRecord = await FileModel.findOne({ hash })
      .select("_id refCount")
      .lean();

    // 3. Finalize via Shared Service
    const finalRec = await finalizeStorageRecord({
      upload,
      hash,
      existingRecord,
      detectedMime,
      status: "uploaded",
    });

    //4. Post-Process (storage manage)
    if (finalRec) {
      await mkdir(
        path.join(UPLOAD_ROOT, parentId.userId.toString()),
        {
          recursive: true,
        },
      );

      const finalPath = path.join(
        UPLOAD_ROOT,
        parentId.userId.toString(),
        hash,
      );

      if (existingRecord) {
        await unlink(mergedPath);
        // console.log("File unlinked...\n", mergedPath);
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

    const { meta, isDeleted, deletedAt, ...file } = finalRec;
    return res.status(201).json({
      success: true,
      message: "File uploaded.",
      data: {
        status: "uploaded",
        progress: 100,
        file,
      },
    });
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
  const { _id, tempDir } = req.uploadSession;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await UploadSession.deleteOne({ _id }).session(session);
    });

    if (tempDir) {
      // Use rm recursive to delete the folder and all its chunks
      rm(tempDir, { recursive: true, force: true }).catch((err) =>
        console.error("cleanup failed:", err),
      );
    }

    return res
      .status(200)
      .json({ success: true, message: "Upload cancelled." });
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

    return res.json({
      success: true,
      data: { status, progress, isCompleted },
    });
  } catch (err) {
    next(err);
  }
};
