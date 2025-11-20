import { Router } from "express";
import upload from "../services/uploadFileUsingMulter.js";

import {
  handleGetFiles,
  handleCreateFile,
  handleUpdateFile,
  handleMoveToBinFile,
  handleRestoreFile
} from "../controllers/apiControllers.js";

const router = Router();

//Create
router.post("/", upload.single("file"), handleCreateFile);
router.post("/:dirId", upload.single("file"), handleCreateFile);

//Read
router.get("/:id", handleGetFiles);

//Update
router.patch("/:id", handleUpdateFile);

//delete
router.post("/:id/trash", handleMoveToBinFile);
router.post("/:id/restore", handleRestoreFile);

export default router;
