import multer from "multer";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import { getErrorObject } from "../utils/helper.js";
import { TEMP_ROOT } from "../misc/constants.js";
/**
 * Multer config: diskStorage + upload instance
 * what it do: Handles single file chunk upload with per-session dynamic size limit.
 * requirements:
 *   - Ensures req.uploadSession is loaded before processing (middleware order matters)
 *   - Creates uploads/temp directory for temporary chunk storage if not present
 *   - Generates unique temporary filenames for each chunk to prevent collisions
 *   - Enforces per-chunk file size limit based on req.uploadSession.chunkSize (+5KB buffer)
 *   - Responds with 413 if chunk exceeds allowed size
 *   - Attaches uploaded file to req.file for downstream processing
 *   - Export: uploadChunk middleware for multer single file upload (fieldname: "file")
 */

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.resolve(TEMP_ROOT);
    if (!dest.startsWith(TEMP_ROOT))
      return cb(new Error("Invalid upload destination."));
    if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `tmp-${uniqueSuffix}`);
  },
});

export const uploadChunk = (req, res, next) => {
  // 1. Ensure loadUploadSession ran first
  if (!req.uploadSession) {
    return next(getErrorObject("Upload-Session not found.", 404));
  }

  // 2. Extract the user's specific chunk size from the database record
  // extra 5KB buffer for multipart/form-data boundary headers
  const limitBytes = req.uploadSession.chunkSize + 5 * 1024;

  // 3. Initialize Multer with the dynamic limit
  const upload = multer({
    storage: diskStorage,
    limits: {
      fileSize: limitBytes,
    },
  }).single("file");

  // 4. Execute Multer and Catch Errors instantly
  upload(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(
            getErrorObject(
              `File chunk too large. Maximum allowed size is ${limitBytes} bytes.`,
            ),
          );
        }
      }

      return next(err);
    }

    if (!req.file) {
      return next(getErrorObject("No file uploaded."));
    }

    next();
  });
};
