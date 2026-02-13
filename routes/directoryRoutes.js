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
  shareDirectoryHandler,
  getDirectoryInfoHandler,
  // GetChildrenHandler,
} from "../controllers/DirectoryControllers.js";
import { restrictRootOperations } from "../middlewares/restrictOperations.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";

const router = Router();

//read
router.get("/:id", getDirectoriesHandler);
router.get("/all-files/:id", getAllFilesHandler);
router.get("/download/:id", restrictRootOperations, downloadDirectoryHandler);
router.get("/info/:id", restrictRootOperations, getDirectoryInfoHandler);

//create
router.post("/new", loadParentDir, createDirectoryHandler);

//update
router.post("/rename/:id", restrictRootOperations, renameDirectoryHandler); //rename
router.post(
  "/move/:id",
  restrictRootOperations,
  loadParentDir,
  moveDirectoryHandler,
); //move
router.post("/share/:id", restrictRootOperations, shareDirectoryHandler); //share
router.post("/:shareToken/shared", restrictRootOperations, shareDirectoryHandler); //share

router.post("/trash/:id", restrictRootOperations, moveToBinDirectoryHandler); //bin
router.post("/restore/:id", restrictRootOperations, restoreDirectoryHandler); //restore

//delete
router.delete("/delete/:id", restrictRootOperations, deleteDirectoryHandler);

export default router;
