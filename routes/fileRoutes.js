import { Router } from "express";

import {
  handleGetFiles,
  handleUpdateFile,
  handleMoveToBinFile,
  handleRestoreFile,
  handleDeleteFile,
} from "../controllers/FileControllers.js";

import { loadParentDir } from "../middlewares/loadParentDirectory.js";

const router = Router();

//Read
router.get("/:id/metadata", handleGetFiles);
router.get("/:id/preview", handleGetFiles);
router.get("/:id/download", handleGetFiles);

//Update
router.patch("/:id", handleUpdateFile); //rename
router.patch("/:id/move", loadParentDir, handleUpdateFile); //move
router.patch("/:id/copy", loadParentDir, handleUpdateFile); //copy
//bulkcopy

router.post("/:id/trash", handleMoveToBinFile); //bin
router.post("/:id/restore", handleRestoreFile); //restore

//delete
router.delete("/:id/delete", handleDeleteFile);

export default router;
