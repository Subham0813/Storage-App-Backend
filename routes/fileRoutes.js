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
  createShareToken,
  makeFileStarred,
} from "../controllers/FileControllers.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";
import { shareHandlerPreProcessor } from "../middlewares/shareHandlerPreProcess.js";
import { getShareInfo } from "../middlewares/getShareInfo.js";
import { revokeAccessPreProcessor } from "../middlewares/revokeAccessPreProcess.js";

const router = Router();

router.get("/preview/:id", previewFileHandler);
router.get("/download/:id", downloadFileHandler);
router.get("/info/:id", getFileInfoHandler); 
router.get("/share-info/:id", getShareInfo("file"));

router.post("/share/:id", shareHandlerPreProcessor, shareFileHandler); 

router.patch("/new-token/:id", createShareToken); 
router.patch("/copy/:id", loadParentDir, copyFileHandler); 
router.patch("/rename/:id", renameFileHandler);
router.patch("/move/:id", loadParentDir, moveFileHandler); 
router.patch("/trash/:id", moveToBinHandler); 
router.patch("/restore/:id", restoreFileHandler); 
router.patch("/public-role/:id", filePublicRoleHandler);
router.patch("/revoke-access/:id", revokeAccessPreProcessor, revokeAccessFileHandler);
router.patch("/starred/:id", makeFileStarred);

router.delete("/delete/:id", deleteFileHandler); 

//bulk operations
// router.post("/bulk-move", moveHandler);
// router.post("/bulk-copy", copyHandler);

// router.post("/bulk-trash", moveToBinHandler);
// router.post("/bulk-restore", restoreHandler);

// router.delete("/bulk-delete", deleteHandler);

export default router;
