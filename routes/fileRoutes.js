import { Router } from "express";
import upload from "../services/upload.js";

import {
  handleGetFiles,
  handleCreateFile,
  handleUpdateFile,
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

export default router;
