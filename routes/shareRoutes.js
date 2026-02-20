import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { notFound } from "../utils/helper.js";
import { Router } from "express";

/**
 * path: /api/shared/resolve/:token
 * what it do: Identify if the token belongs to a file or directory and return its ID.
 */
export const resolveSharedTokenHandler = async (req, res, next) => {
  const { token } = req.params;

  try {
    // 1. Try to find a File
    const file = await UserFile.findOne({ shareToken: token, isDeleted: false })
      .select("_id filename")
      .lean();

    if (file) {
      return res.status(200).json({
        success: true,
        data: { type: "file", id: file._id, name: file.filename },
      });
    }

    // 2. Try to find a Directory
    const dir = await Directory.findOne({ shareToken: token, isDeleted: false })
      .select("_id dirname")
      .lean();

    if (dir) {
      return res.status(200).json({
        success: true,
        data: { type: "directory", id: dir._id, name: dir.dirname },
      });
    }

    return notFound(res, "Link expired or invalid.");
  } catch (err) {
    next(err);
  }
};

const router = Router();
router.get("/resolve/:token", resolveSharedTokenHandler);
export default router;
