import { Router } from "express";

import {
  cancelUpload,
  completeUpload,
  getPresignedUrlForPartNumber,
  getRemainingPresignedUrls,
  initiateUpload,
  saveProgress,
} from "../controllers/uploadControllers.js";

import { loadParentDir } from "../middlewares/loadParentDirectory.js";

const router = Router();

router.get("/part-url/:id", getPresignedUrlForPartNumber);
router.get("/remaining-urls/:id", getRemainingPresignedUrls);

router.post("/initiate", loadParentDir, initiateUpload);

router.put("/save/:id", saveProgress);
router.put("/complete/:id", completeUpload);

router.delete("/cancel/:id", cancelUpload);

export default router;
