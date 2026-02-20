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
import { User } from "../models/user.model.js";
import mongoose from "mongoose";
import { createHash } from "node:crypto";

/**
 * Utility: mergeFileChunks
 * what it do: Merge chunked uploads into a single file using streams to prevent memory exhaustion.
 * requirements:
 *   - upload: UploadSession document with tempDir, totalChunks properties
 *   - mergedPath: destination file path for the merged file
 *   - Reads chunks sequentially and pipes to write stream
 *   - Returns: hashStream
 */
export const mergeFileChunks = async (uploadedChunks, tempDir, mergedPath) => {
  const writeStream = createWriteStream(mergedPath);
  const hashStream = createHash("sha256");

  for (let i = 0; i < uploadedChunks.length; i++) {
    const idx = uploadedChunks[i];
    const chunkPath = path.join(tempDir, `chunk-${idx}`);
    const readStream = createReadStream(chunkPath);

    readStream.on("data", (chunk) => {
      hashStream.update(chunk);
    });
    // readStream.pipe(hashStream, { end: false });

    // { end: false } keeps writeStream open for the next chunk
    await pipeline(readStream, writeStream, {
      end: i === uploadedChunks.length - 1,
    });
  }

  return hashStream.digest("base64url");
};

/**
 * Utility: finalizeStorageRecord
 * what it do: Handle file deduplication via hashing, create database records, update quotas, cleanup temp files.
 * requirements:
 *   - upload: UploadSession document with userId, parentId, filename, size, mime, tempDir
 *   - hash: computed hash of uploaded/merged file
 *   - status: upload status ('uploaded', 'imported', etc., defaults to 'uploaded')
 *   - existingRecord: DB record of physically stored file
 *   - detectedMime: mimetype of the file
 *   - Creates File and UserFile records, updates user storage quota
 *   - Returns: created UserFile document
 */
export const finalizeStorageRecord = async ({
  upload,
  hash,
  existingRecord,
  detectedMime,
  status = "uploaded",
}) => {
  const { _id: parentId, userId, publicRole, sharedWith } = upload.parentId;

  console.log({ upload, hash, existingRecord, detectedMime });

  const isInline = INLINE_MIME.has(detectedMime);
  const disposition = isInline ? "inline" : "attachment";

  let metaId = null;
  let userFile = null;
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      if (!existingRecord) {
        const [newFile] = await FileModel.create(
          [
            {
              userId,
              hash,
              objectKey: hash,
              size: upload.size,
              detectedMime,
            },
          ],
          { session },
        );

        metaId = newFile._id;
      } else {
        metaId = existingRecord._id;

        await FileModel.findByIdAndUpdate(
          existingRecord._id,
          { $inc: { refCount: 1 } },
          { session },
        );
      }

      [userFile] = await UserFile.create(
        [
          {
            filename: upload.filename,
            userId,
            parentId,
            disposition,
            mimetype: detectedMime,
            size: upload.size,
            inline_preview: isInline,
            force_inline_preview: isInline,
            meta: metaId,
            publicRole,
            sharedWith,
            sharedAt:
              publicRole === "VIEWER" || sharedWith.length > 0
                ? new Date()
                : null,
          },
        ],
        { session },
      );

      await UploadSession.findByIdAndUpdate(
        upload._id,
        { status, expiresAt: new Date(Date.now() + 60 * 1000) },
        { session },
      );

      await User.findByIdAndUpdate(
        userId,
        { $inc: { usedStorage: upload.size } },
        { session },
      );

      const visited = new Set();
      const updateQuery = { $inc: { size: upload.size } };
      await updateAncestors(parentId, session, updateQuery, visited);
    });

    return userFile;
  } catch (err) {
    throw err;
  } finally {
    await session.endSession();
  }
};

/**
 * Utility: updateAncestors
 * what it do: Recursively updates ancestor directories (e.g., size increments) within
 * a mongoose transaction session. Protects against cycles using the provided `visited` set.
 * requirements:
 *   - dirId: ObjectId|string - the starting directory id to update ancestors for
 *   - session: mongoose.Session - an active transaction session used for all DB updates
 *   - updateQuery: object - a MongoDB update document (for example: { $inc: { size: n } })
 *   - visited: Set - a Set instance used for cycle detection across recursion
 * returns: Promise<void>
 */
const updateAncestors = async (dirId, session, updateQuery, visited) => {
  if (visited.has(dirId.toString())) return;
  visited.add(dirId.toString());

  const dir = await Directory.findById(dirId).session(session);
  if (!dir) return;

  await Directory.findByIdAndUpdate(dirId, updateQuery, { session });
  await updateAncestors(dir.parentId, session, updateQuery, visited);
};
