import { Directory } from "../models/directory.model.js";

const loadParentDir = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const parentId = req.body.parentId;

    if (parentId && !mongoose.isValidObjectId(parentId)) {
      return res
        .status(400)
        .json({ message: "Invalid id. Directory Not Found!", data: null });
    }

    const parentDirectory = parentId
      ? await Directory.findOne(
          { _id: parentId, isDeleted: false, userId: userId },
          { _id: 1 }
        ).lean()
      : null;

    if (parentId && !parentDirectory)
      return res
        .status(404)
        .json({ message: "Directory Not Found!", data: null });

    req.parentDir = parentDirectory;
    next();
  } catch (err) {
    next(err);
  }
};

export { loadParentDir };
