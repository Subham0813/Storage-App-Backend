import { Router } from "express";

import {
  cancelUpload,
  completeUpload,
  // getPresignedUrlForPartNumber,
  // getRemainingPresignedUrls,
  initiateUpload,
  retryUpload,
  // saveProgress,
} from "../controllers/uploadControllers.js";

import { loadParentDir } from "../middlewares/loadParentDirectory.js";

const router = Router();

// router.get("/part-url/:id", getPresignedUrlForPartNumber);
// router.get("/remaining-urls/:id", getRemainingPresignedUrls);

router.post("/initiate", loadParentDir, initiateUpload);

// router.put("/save/:id", saveProgress);
router.put("/complete/:id", completeUpload);

router.post("/retry/:id", retryUpload);

router.delete("/cancel/:id", cancelUpload);

export default router;
