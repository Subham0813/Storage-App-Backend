import { Router } from "express";
import upload from "../services/upload.js";

import {
  handleGetFiles,
  handleGetDirectories,
  handleCreateFile,
  handleCreateDirectory,
  handleUpdateFile,
  handleUpdateDirectory
} from "../controllers/apiControllers.js";

const { default: directoriesDb } = await import( "../models/directoriesDb.model.json", { with: { type: "json" }});

const router = Router();

router.get("/", (req, res) => {
  res.status(200).json({
    res: true,
    message: "directory found!",
    content: directoriesDb.find((item) => item.id === req.user.id), //serving root directory
  });
});

//Create
router.post("/file", upload.single("file"), handleCreateFile);
router.post("/:dirId/file",upload.single("file"),handleCreateFile);

router.post("/directory", handleCreateDirectory);
router.post("/:dirId/directory", handleCreateDirectory);

//Read
router.get("/file/:id", handleGetFiles);
router.get("/directory/:id", handleGetDirectories);

//Update
router.patch("/file/:id", handleUpdateFile);
router.patch("/directory/:id", handleUpdateDirectory);


export default router;
