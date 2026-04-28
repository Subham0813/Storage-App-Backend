import { Router } from "express";

import {
  getDirectoriesHandler,
  downloadDirectoryHandler,
  createDirectoryHandler,
  moveToBinDirectoryHandler,
  restoreDirectoryHandler,
  deleteDirectoryHandler,
  renameDirectoryHandler,
  moveDirectoryHandler,
  getAllFilesHandler,
  getDirectoryInfoHandler,
  shareDirectoryHandler,
  revokeAccessDirectoryHandler,
  createShareToken,
  directoryPublicRoleHandler,
  makeDirectoryStarred,
  // GetChildrenHandler,
} from "../controllers/DirectoryControllers.js";
import { restrictRootOperations } from "../middlewares/restrictOperations.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";
import { shareHandlerPreProcessor } from "../middlewares/shareHandlerPreProcess.js";
import { getShareInfo } from "../middlewares/getShareInfo.js";
import { revokeAccessPreProcessor } from "../middlewares/revokeAccessPreProcess.js";

const router = Router();

router.get("/all-dirs/:id", getDirectoriesHandler);
router.get("/all-files/:id", getAllFilesHandler);
router.get("/download/:id",  downloadDirectoryHandler);
router.get("/info/:id", getDirectoryInfoHandler);
router.get("/share-info/:id", restrictRootOperations, getShareInfo("dir"));

router.post("/new", loadParentDir, createDirectoryHandler); 
router.post( "/share/:id", restrictRootOperations, shareHandlerPreProcessor, shareDirectoryHandler);

router.patch("/new-token/:id", restrictRootOperations, createShareToken);
router.patch("/rename/:id", restrictRootOperations, renameDirectoryHandler); 
router.patch("/move/:id", restrictRootOperations, loadParentDir, moveDirectoryHandler);
router.patch("/trash/:id", restrictRootOperations, moveToBinDirectoryHandler); 
router.patch("/restore/:id", restrictRootOperations, restoreDirectoryHandler); 
router.patch("/public-role/:id", restrictRootOperations, directoryPublicRoleHandler); 
router.patch("/revoke-access/:id", restrictRootOperations, revokeAccessPreProcessor,revokeAccessDirectoryHandler); 
router.patch("/starred/:id", restrictRootOperations, makeDirectoryStarred)
router.delete("/delete/:id", restrictRootOperations, deleteDirectoryHandler);

export default router;
