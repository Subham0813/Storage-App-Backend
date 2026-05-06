import mongoose from "mongoose";
import { redisClient } from "../configs/radis.js";
import {
  abortS3Upload,
  completeMultipartUpload,
  getS3UploadId,
  getUploadS3PresignedUrls,
} from "../configs/s3Client.js";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { uploadInitSchema } from "../Schemas/userSchema.js";
import { CHUNK, t } from "../misc/constants.js";
import { getErrorObject } from "../utils/helper.js";

const batch_size = 10;
const twoDaysMs = 2 * t._day * t._ms;
const sixHrs = 6 * t._hr;

export const createFileHandler = async (upload, ancestors) => {
  const session = await mongoose.startSession();
  let newfile = null;
  try {
    await session.withTransaction(async () => {
      [newfile] = await UserFile.create(
        [
          {
            ancestors,
            userId: upload.userId,
            parentId: upload.targetId,
            key: upload.key,
            name: upload.name,
            mime: upload.mime,
            size: upload.size,
          },
        ],
        { session },
      );

      if (newfile.ancestors.length > 0) {
        const bulkOps = newfile.ancestors.map((anc_id) => {
          return {
            updateOne: {
              filter: { _id: anc_id },
              update: { $inc: { size: newfile.size } },
            },
          };
        });
        await Directory.bulkWrite(bulkOps, { session });
      }
    });
  } catch (dbErr) {
    throw dbErr;
  } finally {
    await session.endSession();
  }

  const { __v, deletedBy, deletedAt, key, publicRole, ...file } =
    newfile.toObject();
  return file;
};

/**
 * path: /api/uploads/initiate
 * what it do: Initialize a new S3 multipart upload session, validate file size and storage quota,
 *             determine chunk strategy, and return the first batch of pre-signed PUT URLs.
 * requirements:
 *   - req.body: { file: { name: string, size: number, mime: string }, targetId: string (valid MongoDB ObjectId) }
 *   - req.user: authenticated user object provided by `validateSession`
 *   - req.target: populated directory object provided by `loadParentDir` middleware
 */
export const initiateUpload = async (req, res, next) => {
  try {
    const { success, data, error } = uploadInitSchema.safeParse(req.body.file);
    if (!success) {
      const errorMessage = error.issues.map((err) => err.message).join(", ");
      return next(getErrorObject(errorMessage));
    }

    const { name, size, mime } = data;
    const { _id: uid, root, maxQuota } = req.target.userId;
    const userId = req.user._id.toString();

    if (maxQuota - root.size < size)
      return next(getErrorObject("Insufficient storage."));

    const partSize = size > CHUNK[req.user.tier] ? CHUNK[req.user.tier] : size;
    const totalParts = Math.ceil(size / partSize) || 1;
    const lastPartSize = size - (totalParts - 1) * partSize;

    const extension = name.split(".").pop();
    const key = `${uid}/${uid}_${Date.now()}.${extension}`;
    const uploadId = await getS3UploadId(key, mime);

    const initArrayLen = Math.min(totalParts, batch_size);
    const initialParts = Array.from({ length: initArrayLen }, (_, i) => {
      const contentLength = i + 1 === totalParts ? lastPartSize : partSize;
      return { partNumber: i + 1, contentLength };
    });

    const presignedUrls = await getUploadS3PresignedUrls(
      key,
      uploadId,
      initialParts,
    );

    const record = {
      ancestors: req.target.ancestors,
      id: uploadId,
      userId: uid.toString(),
      targetId: req.target._id.toString(),
      ...data,
      key,
      partSize,
      lastPartSize,
      totalParts,
      uploadedParts: [],
      expire: Date.now() + twoDaysMs,
    };

    const uploadKey = `storageApp:user:${userId}:upload:${uploadId}`;
    await Promise.all([
      redisClient.json.set(uploadKey, "$", record),
      redisClient.expire(uploadKey, 200 * t._min),
    ]);

    res.status(201).json({
      success: true,
      message: "Upload initiated.",
      data: {
        session: {
          id: uploadId,
          userId: uid,
          ...data,
          status: "initiated",
          totalParts,
          partSize,
          urls: presignedUrls,
          requestType: "PUT",
          sessionAlive: Date.now() + 200 * t._min * 1000,
          expire: record.expire,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/uploads/save/:id
 * what it do: Acknowledge uploaded S3 parts by storing their ETags in Redis, extend session TTL, and return updated progress.
 * requirements:
 *   - req.params: { id: string } (S3 multipart uploadId)
 *   - req.body: { ETagsWithPartNumbers: Array<{ partNumber: number, ETag: string }> }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const saveProgress = async (req, res, next) => {
  const uploadId = req.params.id;
  const { ETagsWithPartNumbers } = req.body; //zod schema validation - later
  if (!Array.isArray(ETagsWithPartNumbers) || ETagsWithPartNumbers.length < 1) {
    return next(getErrorObject("ETags with part numbers are required."));
  }

  try {
    const uploadKey = `storageApp:user:${req.user._id.toString()}:upload:${uploadId}`;
    const upload = await redisClient.json.get(uploadKey);

    if (!upload) {
      return next(
        getErrorObject("Invalid session id or already expired.", 404),
      );
    }

    const { status, totalParts, uploadedParts, expire } = upload;

    if (expire < Date.now()) {
      await abortS3Upload(upload.key, uploadId);
      await redisClient.del(uploadKey);
      return next(getErrorObject("Upload session expired.", 404));
    } else if (status === "can_complete") {
      return next(getErrorObject("Upload ready to be completed."));
    }

    const existingParts = new Set(uploadedParts.map((p) => p.PartNumber));
    const filteredParts = ETagsWithPartNumbers.filter(
      ({ ETag, partNumber }) =>
        ETag &&
        partNumber > 0 &&
        partNumber <= totalParts &&
        !existingParts.has(partNumber),
    );

    const count = totalParts - (uploadedParts.length + filteredParts.length);
    const progress = Math.floor((count / totalParts) * 100) || 0;
    const isReady = count === totalParts;
    const newStatus = isReady ? "can_complete" : "on_progress";
    
    if (isReady) {
      await redisClient.json.set(uploadKey, "$.status", newStatus);
    }

    if (filteredParts.length > 0) {
      await redisClient.json.arrAppend(
        uploadKey,
        "$.uploadedParts",
        ...filteredParts,
      );
    } else
      return next(getErrorObject("Invalid or already acknowledged parts."));

    await redisClient.expire(uploadKey, sixHrs);

    return res.status(200).json({
      success: true,
      message: "Parts acknowledged.",
      data: {
        session: {
          id: uploadId,
          status: newStatus,
          progress,
          sessionAlive: Date.now() + sixHrs * 1000,
          expire: upload.expire,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/uploads/complete/:id
 * what it do: Finalize S3 multipart upload, create UserFile record in MongoDB, and clean up Redis session.
 * requirements:
 *   - req.params: { id: string } (S3 multipart uploadId)
 *   - req.user: authenticated user object provided by `validateSession`
 *   - All parts must be acknowledged (uploadedParts.length === totalParts)
 */
export const completeUpload = async (req, res, next) => {
  const uploadId = req.params.id;
  const uploadKey = `storageApp:user:${req.user._id.toString()}:upload:${uploadId}`;

  try {
    const upload = await redisClient.json.get(uploadKey);

    if (!upload) {
      return next(
        getErrorObject("Invalid session id or already expired.", 404),
      );
    }

    const { totalParts, uploadedParts, expire } = upload;

    if (expire < Date.now()) {
      await abortS3Upload(upload.key, uploadId);
      await redisClient.del(uploadKey);
      return next(getErrorObject("Upload session expired.", 410));
    } else if (totalParts > uploadedParts.length) {
      return next(getErrorObject("All parts must be uploaded first."));
    }

    const sorted = uploadedParts.sort((a, b) => a.partNumber - b.partNumber);

    let file;
    try {
      const { $metadata } = await completeMultipartUpload(
        upload.key,
        uploadId,
        sorted,
      );

      if ($metadata.httpStatusCode !== 200) {
        throw getErrorObject("Failed to complete multipart upload.", 500);
      }

      file = await createFileHandler(upload, upload.ancestors);
      await redisClient.del(uploadKey);
    } catch (s3OrDbError) {
      console.error("Error during upload completion, aborting:", s3OrDbError);

      await abortS3Upload(upload.key, uploadId).catch(console.error);
      await redisClient.del(uploadKey).catch(console.error);

      throw s3OrDbError;
    }

    return res.status(201).json({
      success: true,
      message: "File uploaded.",
      data: {
        file: {
          _id: file._id,
          parentId: file.parentId,
          userId: file.userId,
          name: file.name,
          mime: file.mime,
          size: file.size,
          isDeleted: false,
          isStarred: false,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/uploads/cancel/:id
 * what it do: Abort the S3 multipart upload and delete the Redis session.
 * requirements:
 *   - req.params: { id: string } (S3 multipart uploadId)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const cancelUpload = async (req, res, next) => {
  try {
    const uploadKey = `storageApp:user:${req.user._id.toString()}:upload:${req.params.id}`;
    const upload = await redisClient.json.get(uploadKey);
    if (!upload) {
      return next(
        getErrorObject("Invalid session id or already expired.", 404),
      );
    }

    await abortS3Upload(upload.key, upload.id);
    await redisClient.del(uploadKey);

    return res
      .status(200)
      .json({ success: true, message: "Upload cancelled." });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/uploads/part-url/:id
 * what it do: Generate a single pre-signed S3 PUT URL for a specific part number. Used to retry a failed part.
 * requirements:
 *   - req.params: { id: string } (S3 multipart uploadId)
 *   - req.query: { partNumber: number }
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getPresignedUrlForPartNumber = async (req, res, next) => {
  const uploadId = req.params.id;
  const partNumber = Number(req.query.partNumber);
  const uploadKey = `storageApp:user:${req.user._id.toString()}:upload:${uploadId}`;
  try {
    const upload = await redisClient.json.get(uploadKey);
    if (!upload) {
      return next(getErrorObject("Upload session already expired.", 404));
    }

    const { uploadedParts, totalParts, key, expire, partSize, lastPartSize } =
      upload;
    if (expire < Date.now()) {
      await abortS3Upload(upload.key, uploadId);
      await redisClient.del(uploadKey);
      return next(getErrorObject("Upload session expired.", 404));
    } else if (uploadedParts.length === totalParts) {
      return next(getErrorObject("Upload session already completed."));
    }

    const existingParts = new Set(uploadedParts.map((p) => p.PartNumber));
    if (
      !partNumber ||
      partNumber < 1 ||
      partNumber > totalParts ||
      existingParts.has(partNumber)
    ) {
      return next(
        getErrorObject("Invalid part number or already acknowledged."),
      );
    }

    const contentLength = partNumber === totalParts ? lastPartSize : partSize;
    const presignedUrl = await getUploadS3PresignedUrls(key, uploadId, [
      { partNumber, contentLength },
    ]);

    await redisClient.expire(uploadKey, sixHrs);
    return res.status(200).json({ success: true, data: { url: presignedUrl } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/uploads/remaining-urls/:id
 * what it do: Generate pre-signed S3 PUT URLs for all remaining (not yet uploaded) parts, up to batch_size at a time.
 * requirements:
 *   - req.params: { id: string } (S3 multipart uploadId)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const getRemainingPresignedUrls = async (req, res, next) => {
  const uploadId = req.params.id;
  const uploadKey = `storageApp:user:${req.user._id.toString()}:upload:${uploadId}`;
  try {
    const upload = await redisClient.json.get(uploadKey);
    if (!upload) {
      return next(getErrorObject("Upload session already expired.", 404));
    }

    const { totalParts, uploadedParts, partSize, lastPartSize, key, expire } =
      upload;

    if (expire < Date.now()) {
      await abortS3Upload(upload.key, uploadId);
      await redisClient.del(uploadKey);
      return next(getErrorObject("Upload session expired.", 404));
    } else if (uploadedParts.length === totalParts) {
      return next(getErrorObject("Upload session already completed."));
    }

    const uploadedSet = new Set(uploadedParts.map((p) => p.PartNumber));
    const remainingParts = [];
    for (let part = 1; part <= totalParts; part++) {
      if (remainingParts.length > batch_size) break;

      if (!uploadedSet.has(part)) {
        const contentLength = part === totalParts ? lastPartSize : partSize;
        remainingParts.push({ partNumber: part, contentLength });
      }
    }

    const presignedUrls = await getUploadS3PresignedUrls(
      key,
      uploadId,
      remainingParts,
    );

    await redisClient.expire(uploadKey, sixHrs);

    return res.status(200).json({
      success: true,
      data: {
        file: {
          id: uploadId,
          urls: presignedUrls,
          requestType: "PUT",
          remainingPartsCount: totalParts - remainingParts.length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};
