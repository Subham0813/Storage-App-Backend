import { Router } from "express";

import {
  getDrivePickerTokenHandler,
  importFromGoogleDriveHandler,
} from "../controllers/importDriveController.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";

const router = Router();

router.get("/google-drive/picker-token", getDrivePickerTokenHandler);
router.post("/google-drive/backup", loadParentDir,importFromGoogleDriveHandler);

export default router;
