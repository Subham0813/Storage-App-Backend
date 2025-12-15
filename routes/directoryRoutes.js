import { Router } from "express";

import {
  handleGetDirectories,
  handleDownloadDirectory,
  handleCreateDirectory,
  handleUpdateDirectory,
  handleMoveToBinDirectory,
  handleRestoreDirectory,
  handleDeleteDirectory
  // handleDelete
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
router.patch("/:id", handleUpdateDirectory);

//delete
router.post("/:id/trash", handleMoveToBinDirectory);
router.post("/:id/restore", handleRestoreDirectory);

router.delete('/:id/delete', handleDeleteDirectory)

export default router;
