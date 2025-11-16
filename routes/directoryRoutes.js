import { Router } from "express";

import {
  handleGetDirectories,
  handleCreateDirectory,
  handleUpdateDirectory,
  handleDeleteDirectory
} from "../controllers/apiControllers.js";

const { default: directoriesDb } = await import(
  "../models/directoriesDb.model.json",
  { with: { type: "json" } }
);

const router = Router();

//read
router.get("/", (req, res) => {
  res.status(200).json({
    res: true,
    message: "directory found!",
    content: directoriesDb.find((item) => item.id === req.user.id), //serving root directory
  });
});

router.get("/:id", handleGetDirectories);

//create
router.post("/", handleCreateDirectory);
router.post("/:dirId", handleCreateDirectory);

//update
router.patch("/:id", handleUpdateDirectory);

//delete
router.delete("/:id", handleDeleteDirectory);

export default router;