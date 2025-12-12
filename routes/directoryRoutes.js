import { Router } from "express";

import {
  handleGetDirectories,
  handleCreateDirectory,
  handleUpdateDirectory,
  handleMoveToBinDirectory,
  handleRestoreDirectory,
  // handleDelete
} from "../controllers/apiControllers.js";
import { validateParent } from "../middlewares/validate.js";

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

// router.delete('/:id', handleDelete)

export default router;
