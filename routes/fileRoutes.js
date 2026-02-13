import { Router } from "express";

import {
  getFileHandler,
  moveToBinHandler,
  restoreFileHandler,
  deleteFileHandler,
  renameFileHandler,
  moveFileHandler,
  copyFileHandler,
  previewFileHandler,
  downloadFileHandler,
  shareFileHandler,
} from "../controllers/FileControllers.js";
import { loadParentDir } from "../middlewares/loadParentDirectory.js";

const router = Router();

//Read
router.get("/info/:id", getFileHandler);
router.get("/preview/:id", previewFileHandler);
router.get("/download/:id", downloadFileHandler);

//Update
router.patch("/rename/:id", renameFileHandler); //rename
router.patch("/copy/:id", loadParentDir, copyFileHandler); //copy
router.patch("/move/:id", loadParentDir, moveFileHandler); //move

router.post("/share/:id", shareFileHandler); //share
router.post("/trash/:id", moveToBinHandler); //bin
router.post("/restore/:id", restoreFileHandler); //restore

router.delete("/delete/:id", deleteFileHandler); //delete

//bulk operations
// router.patch("/bulk-move", moveHandler);
// router.patch("/bulk-copy", copyHandler);

// router.post("/bulk-trash", moveToBinHandler);
// router.post("/bulk-restore", restoreHandler);

// router.delete("/bulk-delete", deleteHandler);

export default router;
