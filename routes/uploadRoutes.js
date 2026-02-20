import express, { Router } from "express";

import {
  cancelUpload,
  completeUpload,
  getUploadStatus,
  initUpload,
  saveChunk,
} from "../controllers/uploadControllers.js";

import { uploadChunk } from "../middlewares/upload.js";
import { loadUploadSession } from "../middlewares/loadUploadSession.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";

const router = Router();

router.get( "/session/:sessionId",express.json(),loadUploadSession, getUploadStatus); //upload-status
router.post("/session/create", express.json(), loadParentDir, initUpload); //init-upload
router.post("/session/chunk/:sessionId", loadUploadSession, uploadChunk, saveChunk); //upload-chunk
router.post("/session/complete/:sessionId", express.json(), loadUploadSession, completeUpload); //complete
router.delete("/session/cancel/:sessionId", express.json(), loadUploadSession, cancelUpload); //cance-upload

export default router;
