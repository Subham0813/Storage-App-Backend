import { Router } from "express";
import { unlink } from "fs/promises";
import path from "path";

import Directory from "../models/directory.model.js";
import FileModel from "../models/file.model.js";

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

const router = Router();

router.get("/storage", async (req, res, next) => {
  const { _id: userId } = req.user;

  try {
    const directories = await Directory.find(
      { userId: userId, parentId: null, isDeleted: false },
      {
        _id: 1,
        name: 1,
        createdAt: 1,
        updatedAt: 1,
      }
    ).lean();

    const files = await FileModel.find(
      { userId: userId, parentId: null, isDeleted: false },
      {
        originalname: 1,
        size: 1,
        detectedMime: 1,
        createdAt: 1,
        modifiedAt: 1,
        _id: 1,
      }
    ).lean();
    const root = {
      directories,
      files,
    };

    res.status(200).json({
      success: true,
      data: root, //serving root directory
    });
  } catch (err) {
    next(err);
  }
});

router.get("/bin", async (req, res, next) => {
  const userId = req.user._id;
  try {
    const directories = await Directory.find(
      { userId: userId, deletedBy: "user" },
      {
        name: 1,
        createdAt: 1,
        deletedAt: 1,
      }
    ).lean();

    const files = await FileModel.find(
      { userId: userId, deletedBy: "user" },
      {
        originalname: 1,
        size: 1,
        detectedMime: 1,
        createdAt: 1,
        deletedAt: 1,
      }
    ).lean();

    // console.log(directories, files);

    const bin = {
      directories,
      files,
    };

    res.status(200).json({
      success: true,
      data: bin, //serving bin directory
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/deleteProfile", async (req, res, next) => {
  const db = req.db;
  const userId = req.user._id;

  try {
    //unlink all files
    const files = FileModel.find(
      { userId },
      { projection: { objectKey: 1 } }
    ).lean();
    for (const file of files) {
      const absolutePath = path.join(path.resolve(UPLOAD_ROOT), file.objectKey);

      if (!absolutePath.startsWith(path.resolve(UPLOAD_ROOT))) {
        console.log(
          "Error: ",
          "Invalid path / file not exists in local ",
          !absolutePath.startsWith(path.resolve(UPLOAD_ROOT))
        );
        return next("Error occured during execution!!");
      }

      try {
        await unlink(absolutePath);
        console.log("File deleted from local..");
      } catch (err) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    }

    //delete all user related infos from Db
    const op = await Promise.all([
      Directory.deleteMany({ userId }),
      FileModel.deleteMany({ userId }),
      db.collection("tokens").deleteMany({ userId }),
      // db.collection("users").deleteOne({ _id: userId }),
    ]);

    return res
      .setHeader(
        "Set-Cookie",
        `uid=; expires=${new Date(new Date() - 3600 * 1000).toUTCString()}`
      )
      .status(200)
      .json({ message: "Account deleted successfully.", data: op });
  } catch (err) {
    next(err);
  }
});

export default router;
