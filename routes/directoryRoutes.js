import { Router } from "express";

import {
  handleGetDirectories,
  handleDownloadDirectory,
  handleCreateDirectory,
  handleUpdateDirectory,
  handleMoveToBinDirectory,
  handleRestoreDirectory,
  handleDeleteDirectory
} from "../controllers/DirectoryControllers.js";
import { validateParent } from "../middlewares/validate.js";

const router = Router();

//read
router.get("/:id", handleGetDirectories);
router.get("/:id/download", handleDownloadDirectory);

//create
router.post("/", handleCreateDirectory);
router.post("/:dirId", validateParent, handleCreateDirectory);

//update
router.patch("/:id", handleUpdateDirectory); //rename
router.patch("/:id/move", validateParent, handleUpdateDirectory); //move

router.post("/:id/trash", handleMoveToBinDirectory); //bin
router.post("/:id/restore", handleRestoreDirectory); //restore

//delete
router.delete('/:id/delete', handleDeleteDirectory)

export default router;
