import mongoose from "mongoose";
import { Directory } from "../models/directory.model.js";

export const loadParentDir = async (req, res, next) => {
  try {
    const parentId = req.body.targetDirId || req.user.rootDirId;

    if (parentId && !mongoose.isValidObjectId(parentId)) {
      return res
        .status(400)
        .json({ message: "Invalid id."});
    }

    const parentDirectory = await Directory.findOne({
      _id: parentId,
      isDeleted: false,
      userId: req.user._id,
    }).lean();

    if (parentId && !parentDirectory)
      return res
        .status(404)
        .json({ message: "Directory Not Found."});

    req.parentDir = parentDirectory;
    next();
  } catch (err) {
    next(err);
  }
};

