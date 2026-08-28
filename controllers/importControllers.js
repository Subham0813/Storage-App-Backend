import z from "zod/v4";
import mongoose from "mongoose";
import crypto from "crypto";

import { google } from "googleapis";
import { Upload } from "@aws-sdk/lib-storage";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { redisClient } from "../configs/redis.js";
import {
  BUCKET_NAME,
  PUBLIC_BUCKET_NAME,
  deleteS3Objects,
  getObjectSize,
  s3Client,
  s3PublicClient,
} from "../services/s3Client.js";

import { UserFile } from "../models/user_file.model.js";
import { User } from "../models/user.model.js";

import { createFileHandler } from "./uploadControllers.js";
import { createNotification } from "../services/notificationService.js";
import { decryptToken } from "../utils/encryption.js";
import { getErrorObject, getFileDoc, getUserLimits } from "../utils/helper.js";
import {
  EXPORT_MAP,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_DRIVE_REDIRECT_URI,
  t,
} from "../misc/constants.js";
import { uploadInitSchema } from "../schemas/userSchema.js";

const twoDaysMs = 2 * t._day * t._ms;
const sixHrs = 6 * t._hr;
const threeHrs = 3 * t._hr;
const twoMins = 2 * t._min;

/**
 * Fetch Google Drive's thumbnail for a file and store it in the public bucket
 * as a CDN-served thumbnail. Never throws — a thumbnail failure must not fail the import.
 */
const makeImportThumbnail = async (drive, googleId, record, importKey) => {
  try {
    const { data } = await drive.files.get({
      fileId: googleId,
      fields: "thumbnailLink",
    });
    const link = data?.thumbnailLink;
    if (!link) return;

    const resp = await fetch(link);
    if (!resp.ok) return;

    const body = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("webp") ? "webp" : "jpg";
    const thumbnailKey = `thumbnails/${record.userId}/${record.id}.${ext}`;

    await s3PublicClient.send(
      new PutObjectCommand({
        Bucket: PUBLIC_BUCKET_NAME,
        Key: thumbnailKey,
        Body: body,
        ContentType: contentType,
        CacheControl: `public, max-age=${2 * t._hr * t._ms}`,
      }),
    );

    await redisClient.json.set(importKey, "$.thumbnailKey", thumbnailKey);
  } catch (err) {
    console.warn("Import thumbnail generation failed:", err.message);
  }
};

const getDriveClient = (integration) => {
  try {
    const auth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_DRIVE_REDIRECT_URI,
    );

    auth.setCredentials({
      refresh_token:
        decryptToken(integration.refreshToken) ?? integration.refreshToken,
    });

    return google.drive({ version: "v3", auth });
  } catch (err) {
    throw new Error("Failed to create Google Drive client: " + err.message);
  }
};

const isGoogleDoc = (mimeType) =>
  mimeType.startsWith("application/vnd.google-apps");

const saveAsLink = async (record, webviewLink, importKey, time) => {
  const session = await mongoose.startSession();
  let newfile;
  try {
    await session.withTransaction(async () => {
      [newfile] = await UserFile.create(
        [
          {
            userId: record.userId,
            parentId: record.targetId,
            path: record.path,
            name: record.name,
            mime: record.mime,
            size: 0,
            extension: record.extension,
            webviewLink: webviewLink,
          },
        ],
        { session },
      );
    });
    record.status = "completed";
    record.fileId = newfile._id.toString();

    await redisClient.json.set(importKey, "$", record);
    await redisClient.expire(importKey, time);
  } catch (err) {
    throw new Error("Failed to save Google Doc as link: " + err.message);
  } finally {
    session.endSession();
  }
};

/**
 * path: /api/import/google/initiate
 * what it do: Create a new Google Drive import session in Redis after validating storage quota.
 * requirements:
 *   - req.body: { file: { id, name, mimeType, sizeBytes }, targetId: string }
 *   - req.user: authenticated user object
 *   - req.target: destination directory populated by `loadParentDir` middleware
 */
export const initiateGoogleImport = async (req, res, next) => {
  try {
    const { success, data, error } = uploadInitSchema.safeParse(req.body.file);
    if (!success || !data.id) {
      const errorMessage =
        error?.issues?.map((err) => err.message)?.join(", ") ||
        "Invalid payload. `id` required.";
      return next(getErrorObject(errorMessage));
    }

    const { name, size, mime, id } = data;
    const userId = req.user._id.toString();
    const targetUserId = req.target.userId._id.toString();

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

    const uploadId = crypto.randomBytes(12).toString("hex");
    const importKey = `storageApp:user:${userId}:import:${uploadId}`;

    const extension = name.split(".").pop();
    const key = `${targetUserId}/${Date.now()}.${extension}`;

    const record = {
      id: uploadId,
      userId: targetUserId,
      uploadedBy: userId,
      key,
      targetId: req.target._id,
      path: req.target.path,
      name: data.name,
      size: data.size,
      mime: data.mime,
      extension,
      googleId: id,
      bytesRead: 0,
      status: "initiated",
      expire: Date.now() + t._day * t._ms,
    };

    await redisClient.json.set(importKey, "$", record);
    await redisClient.expire(importKey, sixHrs);

    delete record.key;
    delete record.googleId;

    res.status(201).json({
      success: true,
      message: "Import initiated.",
      data: {
        file: {
          ...record,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/import/google/start-import/:id
 * what it do: Start streaming a file from Google Drive to S3 asynchronously (fire-and-forget). Returns 202 immediately.
 * requirements:
 *   - req.params: { id: string } (import session id)
 *   - req.user: authenticated user with Google Drive integration connected
 */
export const startGoogleImport = async (req, res, next) => {
  try {
    const importKey = `storageApp:user:${req.user._id.toString()}:import:${req.params.id}`;
    const record = await redisClient.json.get(importKey);
    if (!record)
      return next(getErrorObject("Import session not found or expired.", 404));
    if (record.expire < Date.now()) {
      await redisClient.del(importKey);
      return next(getErrorObject("Import session expired.", 410));
    }
    if (record.status === "on_progress" || record.status === "can_complete")
      return next(getErrorObject("Import already started or completed.", 409));

    const integration = req.user.integrations.googleDrive;
    if (!integration) return next(getErrorObject("Drive not connected."));

    await redisClient.json.set(importKey, "$.status", "on_progress");
    await redisClient.expire(importKey, sixHrs);

    const limits = getUserLimits(req.user);
    const activeKey = `import:active:${req.user._id.toString()}`;
    const activeCount = await redisClient.incr(activeKey);
    if (activeCount > limits.maxUploadConcurrency) {
      await redisClient.decr(activeKey);
      return next(
        getErrorObject("Too many concurrent imports. Please wait.", 429),
      );
    }
    await redisClient.expire(activeKey, 300);

    const decrActive = () => {
      redisClient.decr(activeKey).catch(console.error);
    };

    const notifyImportFailed = () => {
      createNotification({
        userId: record.userId,
        type: "system",
        title: "Import failed",
        message: `"${record.name}" could not be imported. Please try again.`,
        link: "/drive",
      });
    };

    (async () => {
      let key = null;
      try {
        const { googleId } = record;
        const drive = getDriveClient(integration);
        let driveRes = null;
        // --- A. Handle Google Native Docs ---
        if (isGoogleDoc(record.mime)) {
          try {
            driveRes = await drive.files.export(
              { fileId: googleId, mimeType: EXPORT_MAP[record.mime] },
              { responseType: "stream" },
            );
          } catch (exportErr) {
            const parsedErr = JSON.parse(exportErr.message).error;
            if (parsedErr.code === 403) {
              const link = await drive.files.get({
                fileId: googleId,
                fields: "webviewLink",
              });
              return await saveAsLink(
                record,
                link.data.webviewLink,
                importKey,
                twoMins,
              );
            }
            throw exportErr;
          }
        }
        // --- B. Handle Regular Files (PDF, Images) ---
        else {
          try {
            driveRes = await drive.files.get(
              { fileId: googleId, alt: "media" },
              { responseType: "stream" },
            );
          } catch (downloadErr) {
            const parsedErr = JSON.parse(downloadErr.message).error;
            if (parsedErr.code === 403) {
              const link = await drive.files.get({
                fileId: googleId,
                fields: "webviewLink",
              });

              return await saveAsLink(
                record,
                link.data.webviewLink,
                importKey,
                twoMins,
              );
            }

            if (downloadErr.response?.status === 404) {
              await redisClient.json.set(importKey, "$.status", "failed");
              await redisClient.expire(importKey, twoMins);
              notifyImportFailed();
              return;
            }
            throw downloadErr;
          }

          const parallelUploads3 = new Upload({
            client: s3Client,
            params: {
              Bucket: BUCKET_NAME,
              Key: record.key,
              Body: driveRes.data,
              // ContentType: record.mime,
            },
          });

          let lastDbUpdate = Date.now();
          parallelUploads3.on("httpUploadProgress", async (progress) => {
            const now = Date.now();
            if (now - lastDbUpdate > 1000) {
              await redisClient.json.set(
                importKey,
                "$.bytesRead",
                progress.loaded,
              );
              await redisClient.expire(importKey, sixHrs);
              lastDbUpdate = now;
            }
          });

          const upload = await parallelUploads3.done();
          key = upload.Key;

          await makeImportThumbnail(drive, googleId, record, importKey);

          await redisClient.json.set(importKey, "$.status", "can_complete");
          await redisClient.expire(importKey, threeHrs);
        }
      } catch (err) {
        console.error("Import failed: ", err);
        await redisClient.json
          .set(importKey, "$.status", "failed")
          .catch(console.error);
        await redisClient.expire(importKey, threeHrs).catch(console.error);
        if (key) await deleteS3Objects([key]).catch(console.error);
        notifyImportFailed();
      } finally {
        decrActive();
      }
    })();

    res.status(202).json({ success: true, message: "Import started." });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/import/google/complete/:id
 * what it do: Finalize a completed Google Drive import by creating the UserFile record in MongoDB.
 * requirements:
 *   - req.params: { id: string } (import session id)
 *   - req.user: authenticated user object
 *   - Import status must be "can_complete"
 */
export const completeGoogleImport = async (req, res, next) => {
  try {
    const importKey = `storageApp:user:${req.user._id.toString()}:import:${req.params.id}`;

    const record = await redisClient.json.get(importKey);
    if (!record || record.expire < Date.now()) {
      if (record) await redisClient.del(importKey);
      return next(
        getErrorObject("Invalid id or session already expired.", 404),
      );
    }

    if (record.status === "completed") {
      const file = await UserFile.findOne({
        _id: record.fileId,
        userId: record.userId,
      }).lean();
      const fileDoc = getFileDoc(file);

      return res.status(201).json({
        success: true,
        message: "Import completed.",
        data: { item: fileDoc },
      });
    }

    if (record.status !== "can_complete") {
      return next(getErrorObject("Import not completed yet."));
    }

    const realSize = await getObjectSize(record.key);
    if (realSize !== record.size) {
      await deleteS3Objects([record.key]).catch(console.error);
      await redisClient.del(importKey);
      return next(
        getErrorObject("Imported file size does not match expected size.", 413),
      );
    }

    const file = await createFileHandler(record);
    await redisClient.del(importKey);

    createNotification({
      userId: record.userId,
      type: "system",
      title: "Import completed",
      message: `"${record.name}" was imported successfully.`,
      link: `/drive/folders/${record.targetId}`,
    });

    return res.status(201).json({
      success: true,
      message: "Import completed.",
      data: { item: getFileDoc(file) },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/import/google/progress/:id
 * what it do: Return the current status and byte-level progress of an active Google Drive import session.
 * requirements:
 *   - req.params: { id: string } (import session id)
 *   - req.user: authenticated user object
 */
export const getImportProgress = async (req, res, next) => {
  try {
    const importKey = `storageApp:user:${req.user._id.toString()}:import:${req.params.id}`;
    const record = await redisClient.json.get(importKey);
    if (!record) {
      return next(
        getErrorObject("Invalid session id or already expired.", 404),
      );
    }

    const { status, bytesRead, size } = record;
    if (status === "can_complete") {
      return res.status(200).json({
        success: true,
        message: "Import ready to complete.",
        data: {
          file: { id: req.params.id, status, progress: 100, bytesRead },
        },
      });
    } else if (status === "failed") {
      return res.status(200).json({
        success: true,
        message: "Import failed.",
        data: {
          file: { id: req.params.id, status, progress: 0, bytesRead: 0 },
        },
      });
    }

    const progress =
      status === "completed" ? 100 : Math.floor((bytesRead / size) * 100) || 0;
    return res.status(200).json({
      success: true,
      message: "Import in progress.",
      data: { file: { id: req.params.id, status, progress, size, bytesRead } },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/import/google/picker-token
 * what it do: Retrieves a valid Google Drive Access Token for the frontend Picker UI.
 * Automatically refreshes the token if it has expired.
 */
export const getPickerTokenGoogle = async (req, res, next) => {
  try {
    const googleDrive = req.user.integrations?.googleDrive;

    if (!googleDrive || !googleDrive.refreshToken) {
      return next(getErrorObject("Google Drive is not connected."));
    }

    const refreshToken =
      decryptToken(googleDrive.refreshToken) ?? googleDrive.refreshToken;

    const isExpired =
      new Date(googleDrive.expiryDate).getTime() - 60000 < Date.now();

    if (isExpired) {
      const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
      );

      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      const { credentials } = await oauth2Client.refreshAccessToken();

      await User.updateOne(
        { _id: req.user._id },
        {
          $set: {
            "integrations.googleDrive.accessToken": credentials.access_token,
            "integrations.googleDrive.expiryDate": new Date(
              credentials.expiry_date,
            ),
          },
        },
      );
      // bust user cache so next req sees fresh expiry
      await redisClient.del(`storageApp:user:${req.user._id}:userdata`).catch(() => {});

      return res.status(200).json({
        success: true,
        data: { accessToken: credentials.access_token },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        accessToken:
          decryptToken(googleDrive.accessToken) ?? googleDrive.accessToken,
      },
    });
  } catch (err) {
    if (err.message.includes("invalid_grant")) {
      return next(
        getErrorObject(
          "Drive session expired. Please re-link your Google account.",
          401,
        ),
      );
    }
    next(err);
  }
};
