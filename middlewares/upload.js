import multer from "multer";
import path from "path";
import crypto from "crypto";

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