import express, { Router } from "express";

import {
  completeUpload,
  getUploadStatus,
  initUpload,
  uploadChunk,
} from "../controllers/uploadControllers.js";

import upload from "../middlewares/upload.js";
import { loadUploadSession } from "../middlewares/loadUploadSession.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";

const router = Router();

router.post("/init-upload", express.json(), loadParentDir, initUpload);
router.post("/upload-chunk/:uploadId", upload.single("file"), loadUploadSession, uploadChunk);
router.post("/complete-upload/:uploadId", express.json(), loadUploadSession, completeUpload);
router.get("/uploads/:uploadId", express.json(), loadUploadSession, getUploadStatus);

export default router;
