import { Router } from "express";

import {
  handleGetDirectories,
  handleCreateDirectory,
  handleUpdateDirectory,
  handleMoveToBinDirectory,
  handleRestoreDirectory,
} from "../controllers/apiControllers.js";
import { validateParent } from "../middlewares/validateParentId.js";

const router = Router();

//read
router.get("/:id", handleGetDirectories);

//create
router.post("/", handleCreateDirectory);
router.post("/:dirId", validateParent, handleCreateDirectory);

//update
router.patch("/:id", handleUpdateDirectory);

//delete
router.post("/:id/trash", handleMoveToBinDirectory);
router.post("/:id/restore", handleRestoreDirectory);

export default router;
