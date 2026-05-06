import { Router } from "express";

// specific directory actions
import {
  createDirectoryHandler,
  deleteDirectoryHandler,
  getAllFilesHandler,
  getDirectoriesHandler,
} from "../controllers/DirectoryControllers.js";

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
import { restrictRoot } from "../middlewares/restrictOperations.js";

const router = Router();

// GET Routes
router.get("/all-dirs/:id", checkAccess("dir", "view"), getDirectoriesHandler);
router.get("/all-files/:id", checkAccess("dir", "view"), getAllFilesHandler);
router.get("/info/:id", checkAccess("dir", "view"), getItemInfo("dir"));
router.get(
  "/share-info/:id",
  restrictRoot,
  checkAccess("dir", "view"),
  getShareInfo,
);
// router.get("/download/:id", checkAccess("dir", "view"), downloadDirectoryHandler);

// POST Routes
router.post("/new", loadParentDir, createDirectoryHandler);
router.post("/share/:id", restrictRoot, shareAccess("dir"));

// PATCH Routes
router.patch("/new-token/:id", restrictRoot, newShareToken("dir"));
router.patch("/revoke-access/:id", restrictRoot, revokeAccess("dir"));

router.patch("/starred/:id", restrictRoot, starredItem("dir"));
router.patch(
  "/rename/:id",
  restrictRoot,
  checkAccess("dir", "edit"),
  renameItem("dir"),
);
router.patch("/move/:id", restrictRoot, loadParentDir, moveItem("dir"));
// router.patch("/public-role/:id", restrictRoot, changePublicRole("dir"));

//PUT Routes
router.put(
  "/trash/:id",
  restrictRoot,
  checkAccess("dir", "edit"),
  moveToBin("dir"),
);
router.put(
  "/restore/:id",
  restrictRoot,
  checkAccess("dir", "edit"),
  restoreItem("dir"),
);

// DELETE Routes
router.delete("/delete/:id", restrictRoot, deleteDirectoryHandler);

export default router;
