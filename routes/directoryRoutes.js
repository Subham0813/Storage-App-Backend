import { Router } from "express";

import {
  handleGetDirectories,
  handleCreateDirectory,
  handleUpdateDirectory,
  handleMoveToBinDirectory
} from "../controllers/apiControllers.js";

const router = Router();

//read
router.get("/:id", handleGetDirectories);

//create
router.post("/", handleCreateDirectory);
router.post("/:dirId", handleCreateDirectory);

//update
router.patch("/:id", handleUpdateDirectory);

//delete
router.post("/:id/trash", handleMoveToBinDirectory);

export default router;