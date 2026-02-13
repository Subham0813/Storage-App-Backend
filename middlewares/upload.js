import multer from "multer";
import path from "path";
import crypto from "crypto";

/**
 * Multer config: diskStorage + upload instance
 * what it do: Configure file upload destination, generate random filenames for chunks, set 1GB file size limit.
 * requirements:
 *   - Creates uploads/temp directory for temporary chunk storage
 *   - Generates UUID filenames to prevent collisions
 *   - Enforces 1GB max file size per upload
 *   - Export: upload.single(fieldname) for multer middleware attachment
 */

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.resolve(process.cwd(), "uploads/temp"));
  },

  filename: (req, file, cb) => {
    cb(null, crypto.randomUUID()); // SAFE for chunks
  },
});

const upload = multer({
  storage: diskStorage,
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB
  },
});

export default upload;
