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


const router = Router();

//Read
router.get("/info/:id", getFileHandler);
router.get("/preview/:id", previewFileHandler);
router.get("/download/:id", downloadFileHandler);

//Update
router.patch("/rename/:id", renameFileHandler); //rename
router.patch("/move/:id", moveFileHandler); //move
router.patch("/copy/:id", copyFileHandler); //copy
router.patch("/share/:id", shareFileHandler); //share

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
