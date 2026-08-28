import mongoose from "mongoose";
import crypto from "crypto";
import { redisClient } from "../configs/redis.js";
import { invalidateUser } from "../utils/responseCache.js";
import {
  abortS3Upload,
  completeMultipartUpload,
  deleteS3Objects,
  getObjectSize,
  getS3UploadId,
  getStandardPresignedUrl,
  getUploadS3PresignedUrls,
  s3Client,
  BUCKET_NAME,
  PUBLIC_BUCKET_NAME,
  s3PublicClient,
} from "../services/s3Client.js";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import {
  uploadCompleteSchema,
  uploadInitSchema,
} from "../schemas/userSchema.js";
import { t, THUMBNAIL_SIZE } from "../misc/constants.js";
import { getErrorObject, getFileDoc, getUserLimits } from "../utils/helper.js";
import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const twoDaysMs = 2 * t._day * t._ms;

export const createFileHandler = async (upload) => {
  const session = await mongoose.startSession();
  let newfile = null;
  try {
    await session.withTransaction(async () => {
      [newfile] = await UserFile.create(
        [
          {
            path: upload.path,
            userId: upload.userId,
            parentId: upload.targetId,
            key: upload.key,
            name: upload.name,
            mime: upload.mime,
            size: upload.size,
            extension: upload.extension,
            thumbnailKey: upload.thumbnailKey,
          },
        ],
        { session },
      );

      if (newfile.path.length > 0) {
        const bulkOps = newfile.path.map((anc_id) => {
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

  const file = await UserFile.findById(newfile._id)
    .populate({
      path: "parentId",
      select: "name _id",
    })
    .populate({
      path: "userId",
      select: "name email _id",
    });
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

    const targetUserId = req.target.userId._id.toString();
    const userId = req.user._id.toString();

    const limits = getUserLimits(req.user);
    const currentUsedStorage = req.target.userId.root?.size || 0;

    if (limits.maxStorage - currentUsedStorage < size) {
      return next(getErrorObject("Insufficient storage quota."));
    }

    if (size > limits.maxFileSize) {
      return next(
        getErrorObject(
          `File exceeds maximum allowed size of ${limits.maxFileSize / 1e9}GB.`,
          413,
        ),
      );
    }

    const extension = name.split(".").pop();
    const key = `files/${targetUserId}/${Date.now()}.${extension}`;

    let uploadId, presignedUrls, totalParts, partSize, uploadType;

    if (size <= 5 * 1e6) {
      uploadType = "standard";
      uploadId = crypto.randomBytes(12).toString("hex");
      totalParts = 1;
      partSize = size;

      const singleUrl = await getStandardPresignedUrl(key, mime, size);
      presignedUrls = [{ partNumber: 1, contentLength: size, url: singleUrl }];
    } else {
      uploadType = "multipart";

      partSize = size > limits.chunkSize ? limits.chunkSize : size;
      totalParts = Math.ceil(size / partSize) || 1;
      const lastPartSize = size - (totalParts - 1) * partSize;

      uploadId = await getS3UploadId(key, mime);

      const parts = Array.from({ length: totalParts }, (_, i) => ({
        partNumber: i + 1,
        contentLength: i + 1 === totalParts ? lastPartSize : partSize,
      }));

      presignedUrls = await getUploadS3PresignedUrls(key, uploadId, parts);
    }

    // Save session to Redis
    const record = {
      path: req.target.path,
      id: uploadId,
      uploadType,
      uploadedBy: userId,
      userId: targetUserId,
      targetId: req.target._id.toString(),
      ...data,
      extension,
      key,
      partSize,
      totalParts,
      maxConcurrency: limits.maxUploadConcurrency,
      expire: Date.now() + t._day * t._ms,
    };

    const uploadKey = `storageApp:user:${userId}:upload:${uploadId}`;
    await Promise.all([
      redisClient.json.set(uploadKey, "$", record),
      redisClient.expire(uploadKey, t._day + 15),
    ]);

    delete record.key;

    res.status(201).json({
      success: true,
      message: "Upload initiated.",
      data: {
        session: {
          ...record,
          urls: presignedUrls,
          requestType: "PUT",
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
  const { success, data, error } = uploadCompleteSchema.safeParse(req.body);

  if (!success) {
    const errorMessage = error.issues.map((err) => err.message).join(", ");
    return next(getErrorObject(errorMessage));
  }

  const { parts, thumbnailBase64 } = data;

  try {
    const uploadKey = `storageApp:user:${req.user._id.toString()}:upload:${uploadId}`;
    const upload = await redisClient.json.get(uploadKey);

    if (!upload) {
      return next(
        getErrorObject("Invalid session id or already expired.", 404),
      );
    }

    const { totalParts, expire, uploadType } = upload;

    if (expire < Date.now()) {
      if (upload.uploadType === "multipart") {
        await abortS3Upload(upload.key, upload.id);
      }
      await redisClient.del(uploadKey);
      return next(getErrorObject("Upload session expired.", 410));
    } else if (totalParts > parts.length) {
      return next(getErrorObject("All parts must be uploaded first."));
    }

    const sorted = parts
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((p) => ({ ETag: p.ETag, PartNumber: p.partNumber }));

    let file = null;
    let thumbnailKey = null;
    try {
      if (uploadType === "multipart") {
        const { $metadata } = await completeMultipartUpload(
          upload.key,
          uploadId,
          sorted,
        );

        if ($metadata.httpStatusCode !== 200) {
          throw getErrorObject("Failed to complete multipart upload.", 500);
        }
      }

      const realSize = await getObjectSize(upload.key);
      if (realSize !== upload.size) {
        if (uploadType === "multipart") {
          abortS3Upload(upload.key, uploadId).catch(console.error);
        }
        await deleteS3Objects([upload.key]);
        throw getErrorObject(
          "Uploaded file size does not match expected size.",
          413,
        );
      }

      if (thumbnailBase64) {
        try {
          // Strip the data:image prefix to get pure base64
          const base64Data = thumbnailBase64.replace(
            /^data:image\/\w+;base64,/,
            "",
          );
          const buffer = Buffer.from(base64Data, "base64");

          if (buffer.byteLength > THUMBNAIL_SIZE) {
            return next(getErrorObject("Thumbnail size exceeds limit.", 413));
          }

          thumbnailKey = `thumbnails/${upload.userId}/${upload.name}.webp`;

          await s3PublicClient.send(
            new PutObjectCommand({
              Bucket: PUBLIC_BUCKET_NAME,
              Key: thumbnailKey,
              Body: buffer,
              ContentType: "image/webp",
              CacheControl: `public, max-age=${2 * t._hr * t._ms}`,
              ContentEncoding: "base64",
              // Tagging: "type=thumbnail",
            }),
          );
        } catch (thumbErr) {
          console.error("Thumbnail upload failed, skipping:", thumbErr.message);
          s3PublicClient
            .send(
              new DeleteObjectsCommand({
                Bucket: PUBLIC_BUCKET_NAME,
                Delete: { Objects: [{ Key: thumbnailKey }] },
              }),
            )
            .catch(console.error);
        }
      }

      upload.thumbnailKey = thumbnailKey;
      file = await createFileHandler(upload);
      await redisClient.del(uploadKey);

      const userDataKey = `storageApp:user:${upload.userId}:userdata`;
      await redisClient.del(userDataKey);
      await invalidateUser(upload.userId);
    } catch (s3OrDbError) {
      console.error("Error during upload completion, aborting:", s3OrDbError);

      if (upload.uploadType === "multipart") {
        abortS3Upload(upload.key, uploadId).catch(console.error);
      }

      if (thumbnailKey) {
        s3PublicClient
          .send(
            new DeleteObjectsCommand({
              Bucket: PUBLIC_BUCKET_NAME,
              Delete: { Objects: [{ Key: thumbnailKey }] },
            }),
          )
          .catch(console.error);
      }

      redisClient.del(uploadKey).catch(console.error);
      throw s3OrDbError;
    }

    return res.status(201).json({
      success: true,
      message: "File uploaded.",
      data: { item: getFileDoc(file) },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/uploads/retry/:id
 * what it do: Refresh an existing upload session for the same S3 uploadId, so a failed
 *             or interrupted upload can resume from its previously uploaded parts instead
 *             of re-initiating from scratch. Returns fresh presigned URLs for the session.
 * requirements:
 *   - req.params: { id: string } (S3 multipart uploadId)
 *   - req.user: authenticated user object provided by `validateSession`
 */
export const retryUpload = async (req, res, next) => {
  try {
    const uploadId = req.params.id;
    const uploadKey = `storageApp:user:${req.user._id.toString()}:upload:${uploadId}`;
    const upload = await redisClient.json.get(uploadKey);

    if (!upload) {
      return next(
        getErrorObject("Invalid session id or already expired.", 404),
      );
    }

    if (upload.expire < Date.now()) {
      if (upload.uploadType === "multipart") {
        await abortS3Upload(upload.key, upload.id);
      }
      await redisClient.del(uploadKey);
      return next(getErrorObject("Upload session expired.", 410));
    }

    let presignedUrls;
    if (upload.uploadType === "multipart") {
      const parts = Array.from({ length: upload.totalParts }, (_, i) => ({
        partNumber: i + 1,
        contentLength:
          i + 1 === upload.totalParts
            ? upload.size - (upload.totalParts - 1) * upload.partSize
            : upload.partSize,
      }));
      presignedUrls = await getUploadS3PresignedUrls(
        upload.key,
        upload.id,
        parts,
      );
    } else {
      const url = await getStandardPresignedUrl(
        upload.key,
        upload.mime,
        upload.size,
      );
      presignedUrls = [{ partNumber: 1, contentLength: upload.size, url }];
    }

    return res.status(200).json({
      success: true,
      message: "Upload session refreshed.",
      data: {
        session: {
          id: upload.id,
          uploadType: upload.uploadType,
          totalParts: upload.totalParts,
          partSize: upload.partSize,
          maxConcurrency: upload.maxConcurrency,
          urls: presignedUrls,
          requestType: "PUT",
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

    if (upload.uploadType === "multipart") {
      await abortS3Upload(upload.key, upload.id);
    }
    await redisClient.del(uploadKey);

    return res
      .status(200)
      .json({ success: true, message: "Upload cancelled." });
  } catch (err) {
    next(err);
  }
};
