import mongoose from "mongoose";
import { Directory } from "../models/directory.model.js";
import { Permission } from "../models/permission.model.js";
import { UserFile } from "../models/user_file.model.js";
import { User } from "../models/user.model.js";
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
      const itemToken = req.query?.token;

      if (!mongoose.isValidObjectId(itemId)) {
        return next(getErrorObject("Invalid id.", 400));
      }

      const item =
        req.Item ||
        (await Model.findOne({ _id: itemId, isDeleted: false })
          // .select("userId parentId path publicRole")
          .populate("userId", "_id name email avatarUrl")
          .populate("path", "_id name", { isDeleted: false })
          .lean());

      if (!item) return next(getErrorObject("Item not found.", 404));
      if (item.path?.length < 1) item.parentId = null;
      
      if (modelType === "dir") {
        item.filesCount = await UserFile.countDocuments({
          parentId: item._id,
          isDeleted: false,
        });
        item.dirsCount = await Directory.countDocuments({
          parentId: item._id,
          isDeleted: false,
        });
      }
      
      // Check if item is shared with public
      const isTimeExpired = item.shareTokenExpiresAt ?
        (new Date()).toISOString() >
        (new Date(item.shareTokenExpiresAt)).toISOString() : false;
      req.tokenAuth = item.shareToken === itemToken && !isTimeExpired;

      // Token holders can also browse descendants of a shared directory. Nested
      // items don't carry the share token themselves, so resolve the shared
      // directory once and match it against this item's ancestry.
      if (!req.tokenAuth && itemToken) {
        const sharedDir = await Directory.findOne({
          shareToken: itemToken,
          isDeleted: false,
          $or: [
            { shareTokenExpiresAt: null },
            { shareTokenExpiresAt: { $gt: new Date() } },
          ],
        })
          .select("_id")
          .lean();

        if (sharedDir) {
          const sharedDirId = sharedDir._id.toString();
          req.tokenAuth =
            item._id.toString() === sharedDirId ||
            (item.path || []).some((p) => p?._id?.toString() === sharedDirId);
        }
      }

      if (req.tokenAuth && action === "view") {
        // The token holder is NOT necessarily the caller — expose the owner
        // separately so bandwidth/quota checks bill the content owner while
        // req.user remains the (possibly undefined) authenticated caller.
        req.itemOwner = await User.findById(item.userId._id);
        req.Item = item;
        return next();
      }

      // 2. Owner Fast-Pass
      if (req.user && item.userId._id.toString() === req.user._id.toString()) {
        req.Item = item;
        return next();
      }

      // If action is owner, and we didn't pass the owner fast-pass above, reject.
      if (action === "owner") {
        return next(
          getErrorObject("Unauthorized access. Owner access required.", 403),
        );
      }

      const validPermissions = action === "view" ? ["view", "edit"] : ["edit"];
      const allItemsToCheck = [...(item.path || []), item._id];

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
