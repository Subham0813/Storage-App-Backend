import { Router } from "express";

import {
  getDrivePickerTokenHandler,
  importFromGoogleDriveHandler,
} from "../controllers/importDriveController.js";

const router = Router();

router.get("/google-drive/picker-token", getDrivePickerTokenHandler);
router.post("/google-drive/backup", importFromGoogleDriveHandler);

export default router;
