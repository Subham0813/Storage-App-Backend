import { Router } from "express";

// specific file actions
import {
  copyFileHandler,
  deleteFileHandler,
  downloadFileHandler,
  previewFileHandler,
} from "../controllers/FileControllers.js";
import { bulkDownloadHandler } from "../controllers/batchControllers.js";

// Common Getters
import {
  getItemInfo,
  getShareInfo,
} from "../controllers/commonGetControllers.js";

// Common Setters
import {
  moveItem,
  moveToBin,
  newShareToken,
  renameItem,
  restoreItem,
  revokeAccess,
  shareAccess,
  starredItem,
} from "../controllers/commonSetControllers.js";

import { loadParentDir } from "../middlewares/loadParentDirectory.js";
import { checkAccess } from "../middlewares/checkAccessControl.js";

const router = Router();

// GET Routes
router.get("/preview/:id", checkAccess("file", "view"), previewFileHandler);
router.get("/download/:id", checkAccess("file", "view"), downloadFileHandler);
router.get("/info/:id", checkAccess("file", "view"), getItemInfo);
router.get("/share-info/:id", checkAccess("file", "owner"), getShareInfo);

// POST Routes
router.post(
  "/copy/:id",
  checkAccess("file", "owner"),
  loadParentDir,
  copyFileHandler,
);
router.post("/share/:id", shareAccess("file"));
router.post("/bulk-download", bulkDownloadHandler);

// PATCH Routes
router.patch("/new-token/:id", newShareToken("file"));
router.patch("/revoke-access/:id", revokeAccess("file"));

router.patch("/starred/:id", starredItem("file"));
router.patch("/rename/:id", checkAccess("file", "owner"), renameItem("file"));
router.patch(
  "/move/:id",
  checkAccess("file", "owner"),
  loadParentDir,
  moveItem("file"),
);
// router.patch("/public-role/:id", checkAccess("file", "edit"), changePublicRole("file"));

//PUT Routes
router.put("/trash/:id", checkAccess("file", "owner"), moveToBin("file"));
router.put("/restore/:id", restoreItem("file"));

//DELETE Routes
router.delete("/delete/:id", deleteFileHandler);

//bulk operations
// router.post("/bulk-move", moveHandler);
// router.post("/bulk-copy", copyHandler);
// router.post("/bulk-trash", moveToBinHandler);
// router.post("/bulk-restore", restoreHandler);
// router.delete("/bulk-delete", deleteHandler);

export default router;
