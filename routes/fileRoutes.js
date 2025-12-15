import { Router } from "express";
import upload from "../middlewares/upload.js";

import {
  handleGetFiles,
  handleCreateFile,
  handleUpdateFile,
  handleMoveToBinFile,
  handleRestoreFile,
  handleDeleteFile
} from "../controllers/FileControllers.js";
import { validateParent } from "../middlewares/validate.js";
import { MulterError } from "multer";

const router = Router();

const uploadFile = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof MulterError) {
      // A Multer error occurred when uploading.
      console.error("Multer error", err.name, err.message);
      return next("Multer Error occurred!!");
    } else if (err) {
      // An unknown error occurred when uploading.
      console.error("Other error", err.name, err.message);
      return next("Unknown error occured!!");
    }
    // Everything went fine.
    console.error("Upload successfull..✨");
    return next();
  });
};

//Create
router.post("/", uploadFile, handleCreateFile);
router.post("/:dirId", validateParent, uploadFile, handleCreateFile);

//Read

router.get("/:id/metadata", handleGetFiles);
router.get("/:id/preview", handleGetFiles);
router.get("/:id/download", handleGetFiles);

//Update
router.patch("/:id", handleUpdateFile);

router.post("/:id/trash", handleMoveToBinFile);
router.post("/:id/restore", handleRestoreFile);

//delete
router.delete('/:id/delete', handleDeleteFile)

export default router;
