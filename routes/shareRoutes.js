import { Router } from "express";
import { getItemInfo } from "../controllers/commonGetControllers.js";
import {
  downloadFileHandler,
  previewFileHandler,
} from "../controllers/FileControllers.js";
import { verifyShareToken } from "../middlewares/validateSession.js";

const router = Router();

router.get("/:token", verifyShareToken, previewFileHandler);
router.get("/:token/download", verifyShareToken, downloadFileHandler);
router.get("/:token/info", verifyShareToken, getItemInfo);

export default router;
