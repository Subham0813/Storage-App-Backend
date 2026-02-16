import { Router } from "express";

import {
  getFileInfoHandler,
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

router.get("/info/:id", getFileInfoHandler);
router.get("/preview/:id", previewFileHandler);
router.get("/download/:id", downloadFileHandler);
router.get("/new-token/:id", getFileShareToken);

router.patch("/copy/:id", loadParentDir, copyFileHandler);
router.patch("/rename/:id", renameFileHandler);
router.patch("/move/:id", loadParentDir, moveFileHandler);

router.put("/trash/:id", moveToBinHandler);
router.put("/restore/:id", restoreFileHandler);

router.delete("/delete/:id", deleteFileHandler);

router.post("/share/:id", shareHandlerPreProcessor, shareFileHandler); //share
router.patch("/public-role/:id", filePublicRoleHandler); //change public-role
router.patch("/revoke-access/:id", revokeAccessFileHandler); //revoke access

//bulk operations
// router.post("/bulk-move", moveHandler);
// router.post("/bulk-copy", copyHandler);

// router.post("/bulk-trash", moveToBinHandler);
// router.post("/bulk-restore", restoreHandler);

// router.delete("/bulk-delete", deleteHandler);

export default router;
