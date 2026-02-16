import path from "node:path";
import mongoose from "mongoose";
import { existsSync, createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import { google } from "googleapis";
import { DriveIntegration } from "../models/integration.model.js";
import { UploadSession } from "../models/uploadSession.model.js";
import { finalizeStorageRecord } from "../utils/storage.js";
import { Directory } from "../models/directory.model.js";
import { appendFile } from "node:fs/promises";
import { sanitizeName } from "../utils/serve.js";
import { stat } from "node:fs/promises";
import { UserFile } from "../models/user_file.model.js";
import { badRequest } from "../utils/helper.js";

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
  try {
    const { files, targetId } = req.body;
    if (!mongoose.isValidObjectId(targetId))
      return badRequest(res, "Invalid `targetId`.");

    const targetDir = await Directory.findOne({
      _id: targetId,
      userId: req.user._id,
      isDeleted: false,
    }).lean();
    if (!targetDir) return badRequest(res, "Invalid `targetId`.");

    const integration = await DriveIntegration.findOne({
      userId: req.user._id,
      provider: "google-drive",
    });

    if (!integration)
      return res.status(403).json({ message: "Drive not connected." });

    const drive = getDriveClient(integration);
    const drivePath = path.join(
      TMP_ROOT,
      req.user._id.toString(),
      "google-drive",
    );
    await mkdir(drivePath, { recursive: true });

    // 1. Create sessions for frontend polling
    const sessions = await Promise.all(
      files.map(async (file) => {
        const chunkSize = CHUNK_SIZE[req.user.role];
        const totalChunks = Math.ceil(file.sizeBytes / chunkSize) || 1;

        const session = await UploadSession.create({
          userId: req.user._id,
          parentId: targetId,
          filename: file.name,
          size: file.sizeBytes || 0,
          mime: file.mimeType,
          strategy: "google-drive",
          chunkSize,
          totalChunks,
          expiresAt: new Date(Date.now() + 86400000),
        });
        return session;
      }),
    );

    // 2. Immediate response
    res.json({
      success: true,
      message: "Import started.",
      data: {
        sessions: sessions.map((s) => ({
          _id: s._id,
          filename: s.filename,
          size: s.size,
          mime: s.mime,
        })),
      },
    });

    // 3. Background Processing Loop
    (async () => {
      for (let i = 0; i < files.length; i++) {
        const session = sessions[i];
        const file = files[i];

        const tempPath = path.join(
          drivePath,
          `${session._id}-${sanitizeName(file.name)}`,
        );

        let finalPath = null;

        try {
          await UploadSession.findByIdAndUpdate(session._id, {
            status: "importing",
          });

          let driveRes, bytesRead;
          const writeStream = createWriteStream(tempPath);

          writeStream.on("data", (chunk) => {
            bytesRead += chunk.length();
            console.log({ bytesRead });
          });

          // --- A. Handle Google Native Docs ---
          if (isGoogleDoc(file.mimeType)) {
            try {
              driveRes = await drive.files.export(
                { fileId: file.id, mimeType: EXPORT_MAP[file.mimeType] },
                { responseType: "stream" },
              );
            } catch (exportErr) {
              // HANDLE "FILE TOO LARGE" -> FALLBACK TO LINK
              const parsedErr = JSON.parse(exportErr.message).error;
              console.log(parsedErr);
              if (
                parsedErr.code === 403 &&
                parsedErr.errors?.some(
                  (e) => e.reason === "exportSizeLimitExceeded",
                )
              ) {
                console.warn(
                  `[Import] File too large: ${file.name}. Saving as Link.`,
                );

                writeStream.destroy();
                if (existsSync(tempPath))
                  await unlink(tempPath).catch(() => {});

                // Manually create the "Link" UserFile
                await UserFile.create({
                  filename: file.name,
                  userId: req.user._id,
                  parentId: targetId,
                  disposition: "inline",
                  mimetype: "application/vnd.google-apps.link",
                  size: 0,
                  inline_preview: false,
                  force_inline_preview: false,
                  meta: null, // No physical file
                  publicRole: targetDir.publicRole || "NONE",
                  sharedWith: targetDir.sharedWith || [],
                  sharedAt: targetDir.publicRole ? new Date() : null,
                  // Custom Metadata for frontend to open link
                  extraMeta: {
                    isExternal: true,
                    webViewLink: file.url || file.webViewLink,
                    iconUrl: file.iconUrl,
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
            console.log("Import started for ", file.name);
            driveRes = await drive.files.get(
              { fileId: file.id, alt: "media" },
              { responseType: "stream" },
            );
          }

          // --- C. Save Stream to Disk ---
          await pipeline(driveRes.data, writeStream);

          // --- D. Update Real Size ---
          // Google Docs started as size 0. We must check the actual exported size.
          const stats = await stat(tempPath);

          //Pre-Processing
          const hash = await getFileHash(tempPath, "sha256", "base64url");
          const detected = await fileTypeFromFile(tempPath);
          const detectedMime =
            detected?.mime || file.mimeType || "application/octet-stream";

          //Updating the session in DB for consistency.
          const updatedSession = await UploadSession.findByIdAndUpdate(
            session._id,
            { size: stats.size },
          ).populate("parentId", "_id userId publicRole sharedWith");

          finalPath = path.join(UPLOAD_ROOT, req.user._id.toString(), hash);
          await mkdir(path.dirname(finalPath), { recursive: true });
          const exist = await FileModel.findOne({ hash });

          if (exist) {
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
            upload: updatedSession,
            hash,
            exist,
            detectedMime,
            status: "imported",
          });

        } catch (err) {
          console.error(`Import failed for ${file.name}: ${err.message}`);

          // If file moved to storage, and DB failed -> Delete from storage
          if (finalPath) {
             try { await unlink(finalPath); } catch (e) {}
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
      return res.status(403).json({ message: "Drive not connected." });
    }

    const auth = new google.auth.OAuth2({
      client_id: google_client_id,
      client_secret: google_client_secret,
    });

    auth.setCredentials({
      refresh_token: integration.refreshToken,
    });

    const { credentials } = await auth.refreshAccessToken();

    res.json({
      accessToken: credentials.access_token,
    });
  } catch (err) {
    next(err);
  }
};
