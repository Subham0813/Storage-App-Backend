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

router.get("/info/:id", getFileHandler);
router.get("/preview/:id", previewFileHandler);
router.get("/download/:id", downloadFileHandler);

router.patch("/rename/:id", renameFileHandler);
router.patch("/copy/:id", loadParentDir, copyFileHandler);
router.patch("/move/:id", loadParentDir, moveFileHandler);

router.post("/trash/:id", moveToBinHandler);
router.post("/restore/:id", restoreFileHandler);

router.delete("/delete/:id", deleteFileHandler);

router.post("/share/:id", shareFileHandler); //share

//bulk operations
// router.patch("/bulk-move", moveHandler);
// router.patch("/bulk-copy", copyHandler);

// router.post("/bulk-trash", moveToBinHandler);
// router.post("/bulk-restore", restoreHandler);

// router.delete("/bulk-delete", deleteHandler);

export default router;
