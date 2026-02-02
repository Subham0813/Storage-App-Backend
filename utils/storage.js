import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises"; // Optimized streaming
import { rename, unlink, rm, mkdir } from "node:fs/promises";

import { fileTypeFromFile } from "file-type";
import { getFileHash } from "./helper.js";
import { INLINE_MIME } from "../configs/mimeSet.js";
import { File as FileModel } from "../models/file.model.js";
import { UserFile } from "../models/user_file.model.js";
import { UploadSession } from "../models/uploadSession.model.js";
import { Directory } from "../models/directory.model.js";

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

/**
 * Merges chunks using Streams to prevent memory exhaustion
 */
export const mergeFileChunks = async (session, mergedPath) => {
  const writeStream = createWriteStream(mergedPath);
  for (let i = 0; i < session.totalChunks; i++) {
    const chunkPath = path.join(session.tempDir, `chunk-${i}`);
    const readStream = createReadStream(chunkPath);
    // { end: false } keeps writeStream open for the next chunk
    await pipeline(readStream, writeStream, {
      end: i === session.totalChunks - 1,
    });
  }
};

/**
 * Handles Deduplication, Model Creation, and Cleanup
 */
export const finalizeStorageRecord = async (
  session,
  tempFilePath,
  status = "uploaded",
) => {
  const detected = await fileTypeFromFile(tempFilePath);
  const detectedMime =
    detected?.mime || session.mime || "application/octet-stream";
  const isInline = INLINE_MIME.has(detectedMime);
  const disposition = isInline ? "inline" : "attachment";

  const hash = await getFileHash(tempFilePath, "sha256", "base64url");
  const finalPath = path.join(UPLOAD_ROOT, session.userId.toString(), hash);

  await mkdir(path.join(UPLOAD_ROOT, session.userId.toString()), {
    recursive: true,
  });

  let metaId;
  const exist = await FileModel.findOne({ hash });

  if (!exist) {
    await rename(tempFilePath, finalPath);
    const newFile = await FileModel.create({
      userId: session.userId,
      hash,
      hashAlgo: "sha256",
      objectKey: hash,
      size: session.size,
      detectedMime,
      refCount: 1,
      storageProvider: "local",
    });
    metaId = newFile._id;
  } else {
    await unlink(tempFilePath);
    exist.refCount += 1;
    await exist.save();
    metaId = exist._id;
  }

  const userFile = await UserFile.create({
    name: session.fileName,
    userId: session.userId,
    parentId: session.parentId,
    disposition,
    mimetype: detectedMime,
    size: session.size,
    inline_preview: isInline,
    force_inline_preview: isInline,
    meta: metaId,
  });

  await Directory.updateOne(
    { _id: session.parentId },
    { $inc: { size: session.size } },
  );

  if (session.tempDir)
    await rm(session.tempDir, { recursive: true, force: true });
  await UploadSession.updateOne(
    { _id: session._id },
    { status, expiresAt: new Date(Date.now() + 3600 * 1000) },
  );

  return userFile;
};
