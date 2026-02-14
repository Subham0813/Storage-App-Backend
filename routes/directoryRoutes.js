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
  getDirectoryShareToken,
  directoryPublicRoleHandler,
  // GetChildrenHandler,
} from "../controllers/DirectoryControllers.js";
import { restrictRootOperations } from "../middlewares/restrictOperations.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";
import { shareHandlerPreProcessor } from "../middlewares/shareHandlerPreProcess.js";

const router = Router();

router.get("/:id", getDirectoriesHandler);
router.get("/all-files/:id", getAllFilesHandler);
router.get("/download/:id", restrictRootOperations, downloadDirectoryHandler);
router.get("/info/:id", restrictRootOperations, getDirectoryInfoHandler);
router.get("/new-token/:id", restrictRootOperations, getDirectoryShareToken); 

router.post("/new", loadParentDir, createDirectoryHandler);
router.post("/rename/:id", restrictRootOperations, renameDirectoryHandler);
router.post(
  "/move/:id",
  restrictRootOperations,
  loadParentDir,
  moveDirectoryHandler,
);

router.post("/trash/:id", restrictRootOperations, moveToBinDirectoryHandler);
router.post("/restore/:id", restrictRootOperations, restoreDirectoryHandler);

router.post(
  "/share/:id",
  restrictRootOperations,
  shareHandlerPreProcessor,
  shareDirectoryHandler,
); //share

router.post(
  "/public-role/:id",
  restrictRootOperations,
  directoryPublicRoleHandler,
); //change public-role

router.post(
  "/revoke-access/:id",
  restrictRootOperations,
  revokeAccessDirectoryHandler,
); //revoke access

router.delete("/delete/:id", restrictRootOperations, deleteDirectoryHandler);

export default router;
