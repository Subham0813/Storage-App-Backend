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
router.post("/files", upload.single("file"), handleCreateFile);
router.post("/directories/:dirId/files",upload.single("file"),handleCreateFile);

router.post("/directories", handleCreateDirectory);
router.post("/directories/:dirId/directories", handleCreateDirectory);

//Read
router.get("/files/:id", handleGetFiles);
router.get("/directories/:id", handleGetDirectories);

//Update
router.patch("/files/:id", handleUpdateFile);
router.patch("/directories/:id", handleUpdateDirectory);


export default router;
