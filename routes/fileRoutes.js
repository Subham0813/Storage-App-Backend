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

router.get("/info/:id", getFileInfoHandler); //info
router.get("/preview/:id", previewFileHandler); //preview
router.get("/download/:id", downloadFileHandler); //download
router.get("/new-token/:id", getFileShareToken); //new-token

router.post("/share/:id", shareHandlerPreProcessor, shareFileHandler); //share

router.patch("/copy/:id", loadParentDir, copyFileHandler); //copy
router.patch("/rename/:id", renameFileHandler); //rename
router.patch("/move/:id", loadParentDir, moveFileHandler); //move
router.patch("/trash/:id", moveToBinHandler); //trash
router.patch("/restore/:id", restoreFileHandler); //restore
router.patch("/public-role/:id", filePublicRoleHandler); //change public-role
router.patch("/revoke-access/:id", revokeAccessFileHandler); //revoke access

router.delete("/delete/:id", deleteFileHandler); //delete


//bulk operations
// router.post("/bulk-move", moveHandler);
// router.post("/bulk-copy", copyHandler);

// router.post("/bulk-trash", moveToBinHandler);
// router.post("/bulk-restore", restoreHandler);

// router.delete("/bulk-delete", deleteHandler);

export default router;
