import { Router } from "express";

import {
  getFileHandler,
  moveToBinHandler,
  restoreFileHandler,
  deleteFileHandler,
  renameFileHandler,
  moveFileHandler,
  copyFileHandler,
  previewFileHandler,
  downloadFileHandler,
  shareFileHandler,
  revokeAccessFileHandler,
  filePublicRoleHandler,
  getFileShareToken,
} from "../controllers/FileControllers.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";
import { shareHandlerPreProcessor } from "../middlewares/shareHandlerPreProcess.js";

const router = Router();

router.get("/info/:id", getFileHandler);
router.get("/preview/:id", previewFileHandler);
router.get("/download/:id", downloadFileHandler);
router.get("/new-token/:id", getFileShareToken);

router.post("/rename/:id", renameFileHandler);
router.post("/copy/:id", loadParentDir, copyFileHandler);
router.post("/move/:id", loadParentDir, moveFileHandler);

router.post("/trash/:id", moveToBinHandler);
router.post("/restore/:id", restoreFileHandler);

router.delete("/delete/:id", deleteFileHandler);

router.post("/share/:id", shareHandlerPreProcessor, shareFileHandler); //share
router.post("/public-role/:id", filePublicRoleHandler); //change public-role
router.post("/revoke-access/:id", revokeAccessFileHandler); //revoke access

//bulk operations
// router.post("/bulk-move", moveHandler);
// router.post("/bulk-copy", copyHandler);

// router.post("/bulk-trash", moveToBinHandler);
// router.post("/bulk-restore", restoreHandler);

// router.delete("/bulk-delete", deleteHandler);

export default router;
