import { Router } from "express";
import { unlink } from "fs/promises";
import path from "path";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { getDbData } from "../utils/helper.js";


const router = Router();

router.get("/storage", async (req, res, next) => {
  const parent = {
    dirId: null,
    dirName: "root",
    userId: req.user._id,
    isDeleted: false,
  };

  try {
    const data = await getDbData(parent);
    res.status(200).json({
      success: true,
      data, //serving root directory
    });
  } catch (err) {
    next(err);
  }
});

router.get("/bin", async (req, res, next) => {
  const userId = req.user._id;
  try {
    const directories = await Directory.find(
      { userId, deletedBy: "user" },
      { name: 1, createdAt: 1, updatedAt: 1 }
    ).lean();

    const files = await UserFile.find(
      { userId, deletedBy: "user" },
      { name: 1, createdAt: 1, updatedAt: 1 }
    )
      .populate({ path: "meta", select: "detectedMime size -_id" })
      .lean();

    const flattenedFiles = files.map(({ meta, ...rest }) => ({
      ...rest,
      ...meta,
    }));

    const data = {
      name: "Bin",
      directories,
      files: flattenedFiles,
    };
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;
