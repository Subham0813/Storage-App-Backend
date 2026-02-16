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

router.post("/new", loadParentDir, createDirectoryHandler); //new-directory
router.patch("/rename/:id", restrictRootOperations, renameDirectoryHandler); //rename
router.patch(
  "/move/:id",
  restrictRootOperations,
  loadParentDir,
  moveDirectoryHandler,
); //move

router.put("/trash/:id", restrictRootOperations, moveToBinDirectoryHandler); //bin
router.put("/restore/:id", restrictRootOperations, restoreDirectoryHandler); //recover

router.post(
  "/share/:id",
  restrictRootOperations,
  shareHandlerPreProcessor,
  shareDirectoryHandler,
); //share

router.patch(
  "/public-role/:id",
  restrictRootOperations,
  directoryPublicRoleHandler,
); //change public-role

router.patch(
  "/revoke-access/:id",
  restrictRootOperations,
  revokeAccessDirectoryHandler,
); //revoke access

router.delete("/delete/:id", restrictRootOperations, deleteDirectoryHandler);

export default router;
