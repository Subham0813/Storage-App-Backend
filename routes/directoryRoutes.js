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

router.get("/:id", getDirectoriesHandler);
router.get("/all-files/:id", getAllFilesHandler);
router.get("/download/:id", restrictRootOperations, downloadDirectoryHandler);
router.get("/info/:id", restrictRootOperations, getDirectoryInfoHandler);

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

router.delete("/delete/:id", restrictRootOperations, deleteDirectoryHandler);

router.post("/share/:id", restrictRootOperations, shareDirectoryHandler); //share

export default router;
