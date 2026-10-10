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
      // A token must actually be present: an unshared item has no shareToken,
      // so `undefined === undefined` must NOT pass for a tokenless request.
      // Failing this here means any authenticated user could view any item.
      req.tokenAuth = !!itemToken && item.shareToken === itemToken && !isTimeExpired;

      // Token holders can also browse descendants of a shared directory. Nested
      // items don't carry the share token themselves, so resolve the shared
      // directory once and match it against this item's ancestry. Only an item
      // that is still exposed via a live public link (`publicRole: "view"`)
      // may be browsed this way.
      if (!req.tokenAuth && itemToken) {
        const sharedDir = await Directory.findOne({
          shareToken: itemToken,
          publicRole: "view",
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
          req.pathBoundary = sharedDirId;
        }
      }

      if (req.tokenAuth && action === "view") {
        // The token holder is NOT necessarily the caller — expose the owner
        // separately so bandwidth/quota checks bill the content owner while
        // req.user remains the (possibly undefined) authenticated caller.
        req.itemOwner = await User.findById(item.userId._id);
        req.Item = item;
        req.pathBoundary = req.pathBoundary || item._id.toString();
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

      const grants = await Permission.find({
        userId: req.user._id,
        itemId: { $in: allItemsToCheck },
        permission: { $in: validPermissions },
      })
        .select("itemId")
        .lean();

      if (grants.length === 0) {
        return next(getErrorObject("Unauthorized access.", 403));
      }

      // Resolve the shallowest granted ancestor as the visible boundary so
      // descendant paths are truncated at the shared folder rather than the
      // owner's root (prevents the recipient from tracing the owner's tree).
      const grantedIds = new Set(grants.map((g) => g.itemId.toString()));
      let boundaryId = null;
      for (const p of item.path || []) {
        if (p?._id && grantedIds.has(p._id.toString())) {
          boundaryId = p._id.toString();
          break;
        }
      }
      req.pathBoundary = boundaryId || item._id.toString();

      // Access Granted! Attach to req so controllers don't query the DB again
      req.Item = item;
      return next();
    } catch (err) {
      next(err);
    }
  };
};
