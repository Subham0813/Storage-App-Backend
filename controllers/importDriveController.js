import path from "node:path";
import { existsSync, createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import { google } from "googleapis";
import { DriveIntegration } from "../models/integration.model.js";
import { UploadSession } from "../models/uploadSession.model.js";
import { finalizeStorageRecord } from "../utils/storage.js";

const google_client_id = process.env.GOOGLE_CLIENT_ID;

const google_client_secret = process.env.GOOGLE_CLIENT_SECRET;

const google_drive_redirect_uri =
  process.env.GOOGLE_DRIVE_REDIRECT_URI ||
  "http://localhost:4000/integrations/google-drive/callback";

const TMP_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads/temp");

const CHUNK_SIZE = {
  GUEST: 5 * 1024 * 1024,
  USER: 15 * 1024 * 1024,
  ADMIN: 100 * 1024 * 1024,
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

export const importFromGoogleDriveHandler = async (req, res, next) => {
  try {
    const { files, targetParentId } = req.body;
    const integration = await DriveIntegration.findOne({
      userId: req.user._id,
      provider: "google-drive",
    });

    if (!integration)
      return res.status(403).json({ message: "Drive not connected." });

    const drive = getDriveClient(integration);
    const drivePath = path.join(
      TMP_ROOT,
      "google-drive",
      req.user._id.toString(),
    );
    await mkdir(drivePath, { recursive: true });

    // 1. Create sessions for frontend polling
    const sessions = await Promise.all(
      files.map(async (file) => {
        const chunkSize = CHUNK_SIZE[req.user.role];
        const totalChunks = Math.ceil(file.sizeBytes / chunkSize) || 1;

        const session = await UploadSession.create({
          userId: req.user._id,
          parentId: targetParentId || req.user.rootDirId,
          fileName: file.name,
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
      data: { sessions: sessions.map((s) => s._id) },
    });

    // 3. Background Processing Loop
    (async () => {
      for (let i = 0; i < files.length; i++) {
        const session = sessions[i];
        const file = files[i];
        const tempPath = path.join(drivePath, `${session._id}-${file.name}`);
        const writeStream = createWriteStream(tempPath);

        try {
          await UploadSession.updateOne(
            { _id: session._id },
            { status: "uploading" },
          );

          const driveRes = isGoogleDoc(file.mimeType)
            ? await drive.files.export(
                { fileId: file.id, mimeType: EXPORT_MAP[file.mimeType] },
                { responseType: "stream" },
              )
            : await drive.files.get(
                { fileId: file.id, alt: "media" },
                { responseType: "stream" },
              );

          await pipeline(driveRes.data, writeStream); // Safe streaming

          // Finalize using the same logic as manual uploads
          await finalizeStorageRecord(session, tempPath, "imported");
        } catch (err) {
          console.error(`Import failed for ${file.name}: ${err.message}`);

          try {
            // Attempt DB update
            await UploadSession.updateOne(
              { _id: session._id },
              { status: "failed" },
            );
          } catch (dbErr) {
            console.error(
              "Critical: Could not update session status to failed",
              dbErr.message,
            );
          }

          try {
            // Attempt file cleanup
            if (existsSync(tempPath)) await unlink(tempPath);
          } catch (fsErr) {
            console.error(
              "Critical: Could not delete orphaned temp file",
              fsErr,
            );
          }
        }
      }
    })();
  } catch (err) {
    next(err);
  }
};

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
