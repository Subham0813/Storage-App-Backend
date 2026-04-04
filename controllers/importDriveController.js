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
import { getErrorObject, getFileHash } from "../utils/helper.js";
import { TIME, UPLOAD_ROOT, TEMP_ROOT, EXPORT_MAP } from "../misc/constants.js";
import {
  google_client_id,
  google_client_secret,
  google_drive_redirect_uri,
} from "../misc/constants.js";

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

  if (files.length < 1) return next(getErrorObject("Invalid payload."));

  try {
    const integration = await DriveIntegration.findOne({
      userId,
      provider: "google-drive",
    });

    if (!integration) return next(getErrorObject("Drive not connected."));

    const drive = getDriveClient(integration);

    // 0. Pre-process
    let remaining = allotedStorage - usedStorage;
    if (remaining < 1) return next(getErrorObject("Storage limit exceeded."));
    const skipped = [];
    const accepted = [];
    const chunkSize = 16384;

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
        accepted.push({
          userId: parent.userId._id,
          parentId: parent._id,
          filename: file.name || "new file" + file.mimeType,
          size: parseInt(file.sizeBytes) || 0,
          mime: file.mimeType,
          strategy: "google-drive",
          chunkSize,
          totalChunks: Math.ceil(parseInt(file.sizeBytes) / chunkSize) || 1,
          // googleFileId: file.id,
        });
      }
    }

    if (accepted.length < 1)
      return res.status(400).json({
        success: true,
        message: "No files are accepted.",
        data: { skipped },
      });

    // 1. Create sessions for frontend polling
    const sessions = await Promise.all(
      accepted.map((file) => {
        const { _id, filename, size, mime } = UploadSession.create({
          ...file,
          expiresAt: new Date(Date.now() + TIME.ONE_DAY),
        });
        return { _id, filename, size, mime };
      }),
    );

    // 2. Immediate response
    res.status(201).json({
      success: true,
      message: "Import initiated.",
      data: { sessions, skipped },
    });

    // 3. Background Processing Loop
    (async () => {
      for (let i = 0; i < accepted.length; i++) {
        const session = sessions[i];
        if (!session) continue;

        const file = accepted[i];
        const tempPath = path.resolve(
          TEMP_ROOT,
          `google_${req.user._id.toString()}`,
        );
        const filePath = path.resolve(tempPath, file.id);
        await mkdir(tempPath, { recursive: true });

        let finalPath = null;
        let bytesRead = 0;
        let driveRes;
        try {
          let updated = await UploadSession.findOneAndUpdate(
            { _id: session._id, status: "initiated" },
            { status: "importing" },
            { returnDocument: "after" },
          )
            .select("_id")
            .lean();
          console.log(updated);

          // --- A. Handle Google Native Docs ---
          if (isGoogleDoc(file.mime)) {
            try {
              driveRes = await drive.files.export(
                { fileId: file.id, mimeType: EXPORT_MAP[file.mime] },
                { responseType: "stream" },
              );
            } catch (exportErr) {
              // HANDLE "FILE TOO LARGE" -> FALLBACK TO LINK
              // await appendFile(
              //   "./error.log.json",
              //   JSON.stringify(exportErr) + "\n",
              // );
              const parsedErr = JSON.parse(exportErr.message).error;

              if (
                parsedErr.code === 403 &&
                parsedErr.errors?.some(
                  (e) => e.reason === "exportSizeLimitExceeded",
                )
              ) {
                console.warn(
                  `[Import] File too large: ${file.filename}. Saving as Link.`,
                );

                if (existsSync(filePath))
                  await unlink(filePath).catch(() => {});

                const linkMeta = await drive.files.get({
                  fileId: file.id,
                  fields: "webViewLink, iconLink", // Explicitly ask for these fields
                });

                // console.log(file);
                // Manually create the "Link" UserFile
                const session = await mongoose.startSession();
                try {
                  await session.withTransaction(async () => {
                    await UploadSession.updateOne(
                      { _id: updated._id, status: "importing" },
                      { status: "imported" },
                      { session },
                    );

                    await UserFile.create(
                      [
                        {
                          filename: file.filename,
                          userId: parent.userId._id,
                          parentId: parent._id,
                          disposition: "inline",
                          mimetype: "application/vnd.google-apps.link",
                          size: 1024,
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
                        },
                      ],
                      session,
                    );
                  });
                } finally {
                  session.endSession();
                }
                continue;
              }
              throw exportErr;
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
          const controller = new AbortController();
          try {
            const writeStream = createWriteStream(filePath);
            let lastDbUpdate = Date.now();
            console.log(updated);
            driveRes.data.on("data", async (chunk) => {
              bytesRead += chunk.length;
              const now = Date.now();
              if (now - lastDbUpdate > 800) {
                updated = await UploadSession.findOneAndUpdate(
                  { _id: updated._id, status: "importing" },
                  { $set: { bytesRead } },
                  { returnDocument: "after" },
                )
                  .select("_id")
                  .lean();

                if (!updated) {
                  controller.abort("db_update_fails");
                  console.warn("Failed to update session progress");
                  return;
                }

                lastDbUpdate = now;
              }
            });

            await pipeline(driveRes.data, writeStream, {
              signal: controller.signal,
            });
            console.info("Import finished for ", file.filename);
          } catch (pipeErr) {
            if (pipeErr.name === "AbortError")
              console.info(
                "Pipeline was manually aborted:",
                controller.signal.reason,
              );
            else {
              console.error(
                "Pipeline failed due to a system error:",
                err.message,
              );
            }
            throw pipeErr;
          }

          // --- D. Update Real Size ---
          const stats = await stat(filePath);
          if (stats.size === 0) {
            throw new Error("Downloaded file size is 0 bytes.");
          }

          const upload = await UploadSession.findByIdAndUpdate(
            { _id: updated._id, status: "importing" },
            { $set: { size: parseInt(stats.size), bytesRead } },
            { returnDocument: "after" },
          )
            .select("filename parentId size")
            .populate("parentId", "_id userId publicRole sharedWith")
            .lean();

          if (!upload) {
            throw new Error("Upload session not found after file save.");
          }

          //Pre-Finalizing
          const hash = await getFileHash(filePath, "sha256", "base64url");
          const detected = await fileTypeFromFile(filePath);
          const detectedMime =
            detected?.mime || file.mime || "application/octet-stream";

          finalPath = path.resolve(
            UPLOAD_ROOT,
            parent.userId._id.toString(),
            hash,
          );
          await mkdir(path.dirname(finalPath), { recursive: true });

          const existingRecord = await FileModel.findOne({ hash, userId })
            .select("_id")
            .lean();

          if (existingRecord) {
            await unlink(filePath);
            finalPath = null;
          } else {
            await rename(filePath, finalPath);
          }

          // --- E. Finalize ---
          await finalizeStorageRecord({
            upload,
            hash,
            existingRecord,
            detectedMime,
            status: "imported",
          });
        } catch (err) {
          console.error(`Import failed for ${file.filename}: ${err.message}`);

          // If file moved to storage, and DB failed -> Delete from storage
          if (finalPath) {
            await unlink(path.resolve(finalPath)).catch(() => {});
          }

          // Cleanup temp file
          if (existsSync(filePath))
            await unlink(path.resolve(filePath)).catch(() => {});

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

    if (!integration)
      return next(
        getErrorObject("Google Drive integration not found or misconfigured."),
      );

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
      message: "Token refreshed.",
      data: { accessToken: credentials.access_token },
    });
  } catch (err) {
    next(err);
  }
};
