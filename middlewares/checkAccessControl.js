import mongoose from "mongoose";
import { Directory } from "../models/directory.model.js";
import { Permission } from "../models/permission.model.js";
import { UserFile } from "../models/user_file.model.js";
import { getErrorObject } from "../utils/helper.js";

/**
 * Universal ACL Check Middleware
 * Usage: router.get("/files/:id", checkAccess("file", "view"), getFileData);
 */
export const checkAccess = (modelType, action = "view") => {
  return async (req, res, next) => {
    try {
      const Model = modelType === "file" ? UserFile : Directory;
      const itemId = req.params.id;

      if (!mongoose.isValidObjectId(itemId)) {
        return next(getErrorObject("Invalid id.", 400));
      }

      const item = await Model.findById(itemId)
        .select("userId ancestors publicRole")
        .lean();
      if (!item) return next(getErrorObject("Item not found.", 404));

      // 1. Token / Guest Access Fast-Pass (Handled by validateSession)
      if (req.tokenAuth && action === "view") {
        req.Item = item;
        return next();
      }

      // 2. Owner Fast-Pass
      if (req.user && item.userId.toString() === req.user._id.toString()) {
        req.Item = item;
        return next();
      }

      
      const validPermissions = action === "view" ? ["view", "edit"] : ["edit"];
      const allItemsToCheck = [...(item.ancestors || []), item._id];

      const hasAccess = await Permission.exists({
        userId: req.user._id,
        itemId: { $in: allItemsToCheck },
        permission: { $in: validPermissions },
      });

      if (!hasAccess) return next(getErrorObject("Unauthorized access.", 403));

      // Access Granted! Attach to req so controllers don't query the DB again
      req.Item = item;
      return next();
    } catch (err) {
      next(err);
    }
  };
};
