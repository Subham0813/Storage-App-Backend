import { Router } from "express";

import { loadParentDir } from "../middlewares/loadParentDirectory.js";
import {
  completeGoogleImport,
  getImportProgress,
  getPickerTokenGoogle,
  initiateGoogleImport,
  startGoogleImport,
} from "../controllers/importControllers.js";

const router = Router();

// router.get("/google-drive/picker-token", getDrivePickerTokenHandler);
// router.post("/google-drive/backup", loadParentDir,importFromGoogleDriveHandler);

router.get("/google/picker-token", getPickerTokenGoogle);
router.get("/google/progress/:id", getImportProgress);

router.post("/google/initiate", loadParentDir, initiateGoogleImport);

router.put("/google/start-import/:id", startGoogleImport);
router.put("/google/complete/:id", completeGoogleImport);

export default router;
