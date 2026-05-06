import z from "zod/v4";
import mongoose from "mongoose";
import crypto from "crypto";

import { google } from "googleapis";
import { Upload } from "@aws-sdk/lib-storage";

import { redisClient } from "../configs/radis.js";
import { s3Client } from "../configs/s3Client.js";

import { UserFile } from "../models/user_file.model.js";
import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";

import { createFileHandler } from "./uploadControllers.js";
import { getErrorObject } from "../utils/helper.js";
import {
  EXPORT_MAP,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_DRIVE_REDIRECT_URI,
  t,
} from "../misc/constants.js";

const twoDaysMs = 2 * t._day * t._ms;
const sixHrs = 6 * t._hr;
const threeHrs = 3 * t._hr;

const getDriveClient = (integration) => {
  try {
    const auth = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_DRIVE_REDIRECT_URI,
    );

    auth.setCredentials({
      refresh_token: integration.refreshToken,
    });

    return google.drive({ version: "v3", auth });
  } catch (err) {
    throw new Error("Failed to create Google Drive client: " + err.message);
  }
};

const isGoogleDoc = (mimeType) =>
  mimeType.startsWith("application/vnd.google-apps");

const importFileSchema = z.object({
  file: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(255),
    mimeType: z.string().regex(/^[a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+$/),
    sizeBytes: z.string().or(z.number()),
  }),
  targetId: z.string().refine(mongoose.isValidObjectId),
});

/**
 * path: /api/import/google/initiate
 * what it do: Create a new Google Drive import session in Redis after validating storage quota.
 * requirements:
 *   - req.body: { file: { id, name, mimeType, sizeBytes }, targetId: string }
 *   - req.user: authenticated user object
 *   - req.target: destination directory populated by `loadParentDir` middleware
 */
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
    const { success, data, error } = importFileSchema.safeParse(req.body);
    if (!success) {
      const errorMessage = error.issues.map((err) => err.message).join(", ");
      return next(getErrorObject(errorMessage));
    }

    const { file, targetId } = data;
    const userId = req.user._id.toString();
    const { _id: uid, maxQuota, root } = req.target.userId;

    const fileSize = parseInt(file.sizeBytes) || 0;
    if (maxQuota - root.size < fileSize)
      return next(getErrorObject("Insufficient storage."));

    const uploadId = crypto.randomBytes(12).toString("hex");
    const importKey = `storageApp:user:${userId}:import:${uploadId}`;
    const key = `${uid}/${Date.now()}-${file.name}`;
    const record = {
      id: uploadId,
      userId: req.target.userId._id,
      key,
      targetId,
      ancestors: req.target.ancestors,
      name: file.name,
      size: parseInt(file.sizeBytes) || 0,
      mime: file.mimeType,
      googleId: file.id,
      bytesRead: 0,
      status: "initiated",
      expire: Date.now() + twoDaysMs,
    };

    await redisClient.json.set(importKey, "$", record);
    await redisClient.expire(importKey, sixHrs);

    res.status(201).json({
      success: true,
      message: "Import initiated.",
      data: {
        file: {
          ...record,
          sessionAlive: Date.now() + sixHrs * 1000,
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

    const integration = req.user.integrations.find(
      (i) => i.provider === "googleDrive",
    );
    if (!integration) return next(getErrorObject("Drive not connected."));

    await redisClient.json.set(importKey, "$.status", "on_progress");
    await redisClient.expire(importKey, sixHrs);

    (async () => {
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

            if (
              parsedErr.code === 403 &&
              parsedErr.errors?.some(
                (e) => e.reason === "exportSizeLimitExceeded",
              )
            ) {
              console.warn(
                `[Import] File too large: ${record.name}. Saving as Link.`,
              );

              const link = await drive.files.get({
                fileId: googleId,
                fields: "webViewLink",
              });

              let newfile = null;
              const session = await mongoose.startSession();
              try {
                await session.withTransaction(async () => {
                  [newfile] = await UserFile.create(
                    [
                      {
                        userId: record.userId,
                        parentId: record.targetId,
                        ancestors: record.ancestors,
                        googleId: record.googleId,
                        name: record.name,
                        mime: record.mime,
                        size: record.size,
                        webViewLink: link.data.webViewLink,
                      },
                    ],
                    session,
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

                await redisClient.json.set(
                  importKey,
                  "$.status",
                  "can_complete",
                );
                await redisClient.expire(importKey, threeHrs);
              } finally {
                session.endSession();
              }
            } else throw exportErr;
          }
        }
        // --- B. Handle Regular Files (PDF, Images) ---
        else {
          driveRes = await drive.files.get(
            { fileId: googleId, alt: "media" },
            { responseType: "stream" },
          );

          const parallelUploads3 = new Upload({
            client: s3Client,
            params: {
              Bucket: process.env.S3_BUCKET_NAME,
              Key: record.key,
              Body: driveRes.data,
              ContentType: record.mime,
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

          await parallelUploads3.done();

          await redisClient.json.set(importKey, "$.status", "can_complete");
          await redisClient.expire(importKey, threeHrs);
        }
      } catch (err) {
        console.error("Import failed: ", err);
        await redisClient.json
          .set(importKey, "$.status", "failed")
          .catch(console.error);
        await redisClient.expire(importKey, threeHrs).catch(console.error);
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
      return next(getErrorObject("Import session already completed."));
    }

    if (record.status !== "can_complete") {
      return next(getErrorObject("Import not completed yet."));
    }

    const file = await createFileHandler(record, req.target.ancestors);
    await redisClient.del(importKey);

    res.status(201).json({
      success: true,
      message: "Import completed.",
      data: { file },
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
          file: { id: req.params.id, status, progress: 100, bytesRead},
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

    const progress = Math.floor((bytesRead / size) * 100) || 0;
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
 * path: /api/google/picker-token
 * what it do: Retrieves a valid Google Drive Access Token for the frontend Picker UI.
 * Automatically refreshes the token if it has expired.
 */
export const getPickerTokenGoogle = async (req, res, next) => {
  try {
    const googleDrive = req.user.integrations?.googleDrive;

    if (!googleDrive || !googleDrive.refreshToken) {
      return next(getErrorObject("Google Drive is not connected."));
    }

    const isExpired =
      new Date(googleDrive.tokenExpiry).getTime() - 60000 < Date.now();

    if (isExpired) {
      const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
      );

      oauth2Client.setCredentials({
        refresh_token: googleDrive.refreshToken,
      });

      const { credentials } = await oauth2Client.refreshAccessToken();

      await User.updateOne(
        { _id: req.user._id },
        {
          $set: {
            "integrations.googleDrive.accessToken": credentials.access_token,
            "integrations.googleDrive.tokenExpiry": new Date(
              credentials.expiry_date,
            ),
          },
        },
      );

      return res.status(200).json({
        success: true,
        data: { accessToken: credentials.access_token },
      });
    }

    return res.status(200).json({
      success: true,
      data: { accessToken: googleDrive.accessToken },
    });
  } catch (err) {
    next(err);
  }
};
