import express, { Router } from "express";

import { cancelUpload, completeUpload, getUploadStatus, initUpload, uploadChunk
} from "../controllers/uploadControllers.js";

import upload from "../middlewares/upload.js";
import { loadUploadSession } from "../middlewares/loadUploadSession.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";

const router = Router();

router.get( "/session/:sessionId",express.json(),loadUploadSession, getUploadStatus );
router.post("/session/create", express.json(), loadParentDir, initUpload );
router.post("/session/:sessionId/chunk", upload.single("file"), loadUploadSession, uploadChunk );
router.post("/session/:sessionId/complete", express.json(), loadUploadSession, completeUpload );
router.delete("/session/:sessionId/cancel", express.json(), loadUploadSession, cancelUpload );

export default router;
