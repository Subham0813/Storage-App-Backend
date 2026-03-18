import path from "node:path";
import mongoose from "mongoose";
import { existsSync, createWriteStream, createReadStream } from "node:fs";
import { mkdir, rename, unlink, stat, appendFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import { google } from "googleapis";
import { fileTypeFromFile } from "file-type";

import { DriveIntegration } from "../models/integration.model.js";
import { UploadSession } from "../models/uploadSession.model.js";
import { File as FileModel } from "../models/file.model.js";
import { UserFile } from "../models/user_file.model.js";
import { finalizeStorageRecord } from "../utils/storage.js";
import { badRequest, getFileHash } from "../utils/helper.js";
import { TIME } from "../misc/constants.js";

const google_client_id = process.env.GOOGLE_CLIENT_ID;

const google_client_secret = process.env.GOOGLE_CLIENT_SECRET;

const google_drive_redirect_uri = process.env.GOOGLE_DRIVE_REDIRECT_URI;

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

const TMP_ROOT =
  process.env.TMP_ROOT || path.resolve(process.cwd() + "/uploads/temp");

const CHUNK_SIZE = {
  GUEST: 16 * 1024,
  USER: 1024 * 1024,
  ADMIN: 10 * 1024 * 1024,
  SUPER_ADMIN: 10 * 1024 * 1024,
};

const EXPORT_MAP = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.presentation":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const getDriveClient = (integration) => {
  const auth = new google.auth.OAuth2(
    google_client_id,
    google_client_secret,
    google_drive_redirect_uri,
  );

  auth.setCredentials({
    refresh_token: integration.refreshToken,
  });

  return google.drive({ version: "v3", auth });
};

const isGoogleDoc = (mimeType) =>
  mimeType.startsWith("application/vnd.google-apps");

/**
 * path: /api/import/google-drive/backup
 * what it do: Start importing files from Google Drive to the specified target directory, with background async processing.
 * requirements:
 *   - req.body: { files: [{ id, name, sizeBytes, mimeType, url?, webViewLink?, iconUrl? }], targetId: string }
 *   - req.user: authenticated user object provided by `validateSession`
 *   - `targetId` must be a valid directory id where user has write access
 *   - Google Drive integration must exist for the user
 */
export const importFromGoogleDriveHandler = async (req, res, next) => {
  const { files } = req.body;
  const { _id: userId, role, allotedStorage, usedStorage } = req.user;
  const parent = req.parent;

  if (files.length < 1) return badRequest(res, "Invalid payload.");

  try {
    const integration = await DriveIntegration.findOne({
      userId,
      provider: "google-drive",
    });

    if (!integration)
      return res.status(403).json({ message: "Drive not connected." });

    const drive = getDriveClient(integration);

    // 0. Pre-process
    let remaining = allotedStorage - usedStorage;
    if (remaining < 1) return badRequest(res, "Storage limit exceeded.");
    const skipped = [];
    const accepted = [];
    const chunkSize = CHUNK_SIZE[role];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      remaining -= parseInt(file.sizeBytes) || 0;

      if (remaining < 1 || !file.id || !file.mimeType) {
        skipped.push({
          ...file,
          reason:
            !file.id || !file.mimeType
              ? "Invalid file."
              : "Insufficient storage space.",
        });
      } else {
        const tempPath = path.join(
          TMP_ROOT,
          `google-${req.user._id}-${file._id}-${file.name}`,
        );
        await mkdir(path.dirname(tempPath), { recursive: true });
        accepted.push({
          id: file.id,
          userId: parent.userId._id,
          parentId: parent._id,
          filename: file.name || "new file" + file.mimeType,
          size: parseInt(file.sizeBytes) || 0,
          mime: file.mimeType,
          strategy: "google-drive",
          chunkSize,
          totalChunks: Math.ceil(parseInt(file.sizeBytes) / chunkSize) || 1,
          tempDir: tempPath,
          // googleFileId: file.id,
        });
      }
    }
    if (accepted.length < 1)
      return res.status(400).json({
        success: false,
        message: "No files accepted.",
        data: { skipped },
      });

    // 1. Create sessions for frontend polling
    const sessions = await Promise.all(
      accepted.map(({ id, ...file }) =>
        UploadSession.create({
          ...file,
          expiresAt: new Date(Date.now() + TIME.ONE_DAY),
        }),
      ),
    );

    // 2. Immediate response
    res.status(201).json({
      success: true,
      message: "Import initiated.",
      data: {
        sessions: sessions.map(({ _id, filename, size, mime }) => ({
          _id,
          filename,
          size,
          mime,
        })),
        skipped,
      },
    });

    // 3. Background Processing Loop
    (async () => {
      for (let i = 0; i < accepted.length; i++) {
        const session = sessions[i];
        const file = accepted[i];

        if (!session) continue;

        const tempPath = session.tempDir;

        let finalPath = null;
        let bytesRead = 0;
        let driveRes;
        try {
          await UploadSession.findByIdAndUpdate(session._id, {
            status: "importing",
          });

          // --- A. Handle Google Native Docs ---
          if (isGoogleDoc(file.mime)) {
            try {
              driveRes = await drive.files.export(
                { fileId: file.id, mimeType: EXPORT_MAP[file.mime] },
                { responseType: "stream" },
              );
            } catch (exportErr) {
              // HANDLE "FILE TOO LARGE" -> FALLBACK TO LINK
              await appendFile(
                "./error.log.json",
                JSON.stringify(exportErr) + "\n",
              );
              const parsedErr = JSON.parse(exportErr.message).error;
              console.error(parsedErr);

              if (
                parsedErr.code === 403 &&
                parsedErr.errors?.some(
                  (e) => e.reason === "exportSizeLimitExceeded",
                )
              ) {
                console.warn(
                  `[Import] File too large: ${file.filename}. Saving as Link.`,
                );

                if (existsSync(tempPath))
                  await unlink(tempPath).catch(() => {});

                const linkMeta = await drive.files.get({
                  fileId: file.id,
                  fields: "webViewLink, iconLink", // Explicitly ask for these fields
                });

                // console.log(file);
                // Manually create the "Link" UserFile
                await UserFile.create({
                  filename: file.filename,
                  userId: parent.userId._id,
                  parentId: parent._id,
                  disposition: "inline",
                  mimetype: "application/vnd.google-apps.link",
                  size: 0,
                  inline_preview: false,
                  force_inline_preview: false,
                  meta: null, // No physical file
                  publicRole: parent.publicRole || "NONE",
                  sharedWith: parent.sharedWith || [],
                  sharedAt: parent.publicRole ? new Date() : null,
                  // Custom Metadata for frontend to open link
                  linkMeta: {
                    // driveId: integration.providerId,
                    fileId: file.id,
                    webViewLink: linkMeta.data.webViewLink,
                    // iconLink: linkMeta.data.iconLink,
                  },
                });

                await UploadSession.findByIdAndUpdate(session._id, {
                  status: "imported",
                  size: 0,
                });
                continue; // Skip the rest of the loop for this file
              }
              throw exportErr; // Rethrow other errors
            }
          }
          // --- B. Handle Regular Files (PDF, Images) ---
          else {
            console.info("Import started for ", file.filename);
            driveRes = await drive.files.get(
              { fileId: file.id, alt: "media" },
              { responseType: "stream" },
            );
          }

          // --- C. Save Stream to Disk ---
          let lastDbUpdate = Date.now();
          driveRes.data.on("data", (chunk) => {
            bytesRead += chunk.length;
            const now = Date.now();
            if (now - lastDbUpdate > TIME.FIVE_SECONDS) {
              UploadSession.updateOne(
                { _id: session._id },
                { $set: { bytesRead } },
              ).catch(() => {
                (err) =>
                  console.error(
                    `Progress update failed for ${file.filename}:`,
                    err.message,
                  );
              });
              lastDbUpdate = now;
            }
          });

          await pipeline(driveRes.data, createWriteStream(tempPath));
          console.info("Import finished for ", file.filename);

          // --- D. Update Real Size ---
          // Google Docs started as size 0. We must check the actual exported size.
          const stats = await stat(tempPath);

          //Updating the session in DB for consistency.
          const upload = await UploadSession.findOneAndUpdate(
            { _id: session._id },
            { $set: { size: parseInt(stats.size), bytesRead } },
            { new: true },
          )
            .select("filename parentId size")
            .populate("parentId", "_id userId publicRole sharedWith")
            .lean();
          // console.info(upload);

          //Pre-Processing
          const hash = await getFileHash(tempPath, "sha256", "base64url");
          const detected = await fileTypeFromFile(tempPath);
          const detectedMime =
            detected?.mime || file.mime || "application/octet-stream";

          finalPath = path.join(UPLOAD_ROOT, parent.userId._id.toString(), hash);
          await mkdir(path.dirname(finalPath), { recursive: true });

          const existingRecord = await FileModel.findOne({
            hash,
            userId,
          })
            .select("_id")
            .lean();

          if (existingRecord) {
            await unlink(tempPath);
            // Deduplication: The file exists at 'finalPath' already (from a previous upload),
            // so we don't set finalPath variable (to avoid deleting someone else's file on error)
            finalPath = null;
          } else {
            await rename(tempPath, finalPath);
            // We moved it! If DB fails later, we MUST delete this specific path.
          }

          // --- E. Finalize (Deduplication, Hashing, Quota) ---
          await finalizeStorageRecord({
            upload,
            hash,
            existingRecord,
            detectedMime,
            status: "imported",
          });
        } catch (err) {
          console.error(`Import failed for ${file.filename}: ${err.message}`);

          const logEntry = {
            id: crypto.randomUUID().replaceAll("-", ""),
            timestamp: new Date().toISOString(),
            url: req.originalUrl,
            method: req.method,
            user: req.user ? req.user.email || req.user._id : undefined,
            error: {
              name: err.name,
              message: err.message,
              stack: err.stack,
              code: err.code,
              details: err?.details || err?.errInfo || undefined,
              status: err.status || undefined,
              type: err.constructor ? err.constructor.name : undefined,
            },
            requestBody: req.body,
            query: req.query,
            params: req.params,
          };
          try {
            await appendFile(
              "./error.log.json",
              JSON.stringify(logEntry) + ",\n",
            );
          } catch (e) {
            console.error("Logging failed", e);
          }

          // If file moved to storage, and DB failed -> Delete from storage
          if (finalPath) {
            try {
              await unlink(path.normalize(finalPath));
            } catch (e) {}
          }

          // Cleanup temp file
          if (existsSync(tempPath)) await unlink(tempPath).catch(() => {});

          // Session failed
          await UploadSession.updateOne(
            { _id: session._id },
            { status: "failed" },
          );
        }
      }
    })();
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/import/google-drive/picker-token
 * what it do: Return a refreshed Google Drive access token for use by the frontend file picker.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 *   - Google Drive integration must exist and be properly configured with refresh token
 */
export const getDrivePickerTokenHandler = async (req, res, next) => {
  try {
    const integration = await DriveIntegration.findOne({
      userId: req.user._id,
      provider: "google-drive",
      stateCreatedAt: { $exists: false },
    });

    if (!integration) {
      return badRequest(
        res,
        "Google Drive integration not found or misconfigured.",
      );
    }

    const auth = new google.auth.OAuth2({
      client_id: google_client_id,
      client_secret: google_client_secret,
    });

    auth.setCredentials({
      refresh_token: integration.refreshToken,
    });

    const { credentials } = await auth.refreshAccessToken();

    res.status(200).json({
      success: true,
      data: { accessToken: credentials.access_token },
    });
  } catch (err) {
    next(err);
  }
};
