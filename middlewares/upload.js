import multer from "multer";
import { existsSync, mkdirSync } from "fs";
import { badRequest } from "../utils/helper.js";

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

const TMP_ROOT = process.env.TMP_ROOT;

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!existsSync(TMP_ROOT)) {
      mkdirSync(TMP_ROOT, { recursive: true });
    }
    cb(null, TMP_ROOT);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `tmp-${uniqueSuffix}`);
  },
});

export const uploadChunk = (req, res, next) => {
  // 1. Ensure loadUploadSession ran first
  if (!req.uploadSession) {
    return res
      .status(500)
      .json({ message: "Upload session not loaded before file processing." });
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
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          // 413 Payload Too Large
          success: false,
          message: `Chunk exceeds the allowed size limit of ${req.uploadSession.chunkSize} bytes.`,
        });
      }
      return badRequest(res, err.message);
    } else if (err) {
      next(err);
    }

    next();
  });
};
