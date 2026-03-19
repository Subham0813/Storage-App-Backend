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
  getNewDirectoryShareToken,
  directoryPublicRoleHandler,
  makeDirectoryStarred,
  // GetChildrenHandler,
} from "../controllers/DirectoryControllers.js";
import { restrictRootOperations } from "../middlewares/restrictOperations.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";
import { shareHandlerPreProcessor } from "../middlewares/shareHandlerPreProcess.js";
import { getShareInfo } from "../middlewares/getShareInfo.js";

const router = Router();

router.get("/:id", getDirectoriesHandler);
router.get("/all-files/:id", getAllFilesHandler);
router.get("/download/:id", restrictRootOperations, downloadDirectoryHandler);
router.get("/new-token/:id", restrictRootOperations, getNewDirectoryShareToken);
router.get("/info/:id", getDirectoryInfoHandler);
router.get("/share-info/:id", restrictRootOperations, getShareInfo("dir"));

router.post("/new", loadParentDir, createDirectoryHandler); //new-directory
router.post( "/share/:id", restrictRootOperations, shareHandlerPreProcessor, shareDirectoryHandler); //share

router.patch("/rename/:id", restrictRootOperations, renameDirectoryHandler); //rename
router.patch("/move/:id", restrictRootOperations, loadParentDir, moveDirectoryHandler); //move
router.patch("/trash/:id", restrictRootOperations, moveToBinDirectoryHandler); //bin
router.patch("/restore/:id", restrictRootOperations, restoreDirectoryHandler); //recover
router.patch("/public-role/:id", restrictRootOperations, directoryPublicRoleHandler); //change public-role
router.patch("/revoke-access/:id", restrictRootOperations, revokeAccessDirectoryHandler); //revoke access
router.patch("/starred/:id", restrictRootOperations, makeDirectoryStarred)
router.delete("/delete/:id", restrictRootOperations, deleteDirectoryHandler);

export default router;
