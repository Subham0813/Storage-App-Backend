import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { notFound } from "../utils/helper.js";
import { Router } from "express";
import { restrictRootOperations } from "../middlewares/restrictOperations.js";
import { getShareInfo } from "../middlewares/getShareInfo.js";
import { validateSession } from "../middlewares/validateSession.js";

/**
 * path: /api/shared/resolve/:token
 * what it do: Identify if the token belongs to a file or directory and return its ID.
 */
export const resolveSharedTokenHandler = async (req, res, next) => {
  const { token } = req.params;

  try {
    // 1. Try to find a File
    const file = await UserFile.findOne({ shareToken: token, isDeleted: false })
      .select("_id filename sharedWith sharedAt publicRole")
      .lean();

    if (file) {
      return res.status(200).json({
        success: true,
        data: { type: "file", file },
      });
    }

    // 2. Try to find a Directory
    const directory = await Directory.findOne({ shareToken: token, isDeleted: false })
      .select("_id dirname sharedWith sharedAt publicRole")
      .lean();

    if (directory) {
      return res.status(200).json({
        success: true,
        data: { type: "directory", directory },
      });
    }

    return notFound(res, "Link expired or invalid.");
  } catch (err) {
    next(err);
  }
};

const router = Router();
router.get("/resolve/:token", resolveSharedTokenHandler);
router.get("/share-info/file/:id",validateSession, getShareInfo("file"));
router.get("/share-info/directory/:id", validateSession, restrictRootOperations, getShareInfo("dir"));
export default router;
