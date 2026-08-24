import mongoose from "mongoose";
import crypto from "crypto";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import {
  getErrorObject,
  attachPermissionsCount,
  getFileDoc,
} from "../utils/helper.js";
import { base64URLEncode } from "./oauthControllers.js";
import { Permission } from "../models/permission.model.js";

/**
 * path: /api/files/info/:id or /api/directories/info/:id
 * what it do: Return full metadata for a file or directory, including populated path and owner.
 */
export const getItemInfo = (req, res, next) => {
  try {
    if (!req.Item) return next(getErrorObject("Item not found.", 404));
    const file = getFileDoc(req.Item);
    if (req.tokenAuth) delete file.owner;
    return res.status(200).json({ success: true, data: { item: file } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/share-info/:id or /api/directories/share-info/:id
 * what it do: Return sharing state (Permission records + publicRole) for an item. Owner only.
 * requirements:
 *   - req.Item: item object populated by `checkAccess` middleware
 *   - req.user: authenticated user (must be item owner, no token/guest access)
 *   - req.query: { limit?: number, cursor?: ObjectId string, public?:number }
 */
export const getShareInfo = async (req, res, next) => {
  const lim = parseInt(req.query?.limit);
  const limit = lim > 0 && lim <= 100 ? lim : 50;

  const cursor = req.query?.cursor;
  if (cursor && !mongoose.isValidObjectId(cursor))
    return next(getErrorObject("Invalid cursor."));

  const query = { itemId: req.Item._id };
  if (cursor) query._id = { $gt: cursor };

  try {
    const permissions = await Permission.find(query)
      .populate("userId", "_id name email avatarUrl")
      .populate("grantedBy", "_id name email")
      .select("itemId userId grantedBy permission")
      .sort({ _id: 1 })
      .limit(limit)
      .lean();

    const nextCursor =
      permissions.length < limit
        ? null
        : permissions[permissions.length - 1]._id;

    const formattedPermissions = permissions.map((p) => {
      const pObj = { ...p };
      delete pObj._id;
      if (pObj.userId && typeof pObj.userId === "object") {
        const u = { ...pObj.userId };
        if (u._id) {
          u.id = u._id.toString();
          delete u._id;
        }
        pObj.userId = u;
      }
      if (pObj.grantedBy && typeof pObj.grantedBy === "object") {
        const g = { ...pObj.grantedBy };
        if (g._id) {
          g.id = g._id.toString();
          delete g._id;
        }
        pObj.grantedBy = g;
      }
      pObj.id = p.itemId.toString();
      delete pObj.itemId;
      return pObj;
    });

    const isPublic = parseInt(req.query?.public) || "";
    const publicPermission = {};
    if (isPublic === 1) {
      if (req.Item.accessLevel === "public") {
        publicPermission["permission"] = req.Item.publicRole;
        publicPermission["token"] = req.Item.shareToken;
        publicPermission["sharedAt"] = req.Item.sharedAt;
        publicPermission["expiresAt"] = req.Item.shareTokenExpiresAt;
      } else {
        publicPermission["permission"] = "none";
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        permissions: formattedPermissions,
        nextCursor,
        publicPermission,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getNewShareToken = (model) => {
  return async (req, res, next) => {
    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    if (!Model) next("No `model` param found.");

    if (!mongoose.isValidObjectId(req.params.id))
      return next(getErrorObject("Invalid id."));

    const shareToken = base64URLEncode(crypto.randomBytes(32));
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const { modifiedCount } = await Model.updateOne(
          { _id: req.params.id, userId: req.user._id, isDeleted: false },
          { $set: { shareToken } },
          { session },
        );

        if (modifiedCount === 0) throw getErrorObject("item not found.", 404);
      });

      return res
        .status(201)
        .json({ success: true, data: { newToken: shareToken } });
    } catch (err) {
      next(err);
    } finally {
      session.endSession();
    }
  };
};

/**
 * path: /api/user/bin/files or /api/user/bin/dirs
 * what it do: Return paginated list of items soft-deleted by the user (in bin).
 * requirements:
 *   - model: "file" | "dir"
 *   - req.user: authenticated user object
 *   - req.query: { limit?: number, cursor?: ObjectId string }
 */
export const getBinnedItems = (model) => {
  return async (req, res, next) => {
    const lim = parseInt(req.query?.limit);
    const limit = lim > 0 && lim <= 100 ? lim : 50;

    const cursor = req.query?.cursor;
    if (cursor && !mongoose.isValidObjectId(cursor))
      return next(getErrorObject("Invalid cursor."));

    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    if (!Model) next("No `model` param found.");

    const projectionStr =
      "userId parentId name mime size isDeleted deletedAt craetedAt updatedAt";
    const query = { deletedBy: "user", userId: req.user._id };
    if (cursor) query._id = { $gt: cursor };

    try {
      let items = await Model.find(query).populate("path", "_id name").populate("parentId", "_id name").sort({ _id: 1 }).limit(limit).lean();
      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;

      const itemDocs = items.map((f) => getFileDoc(f));
      return res
        .status(200)
        .json({ success: true, data: { items: itemDocs, nextCursor } });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/user/starred/files or /api/user/starred/dirs
 * what it do: Return paginated list of starred items for the authenticated user.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.user: authenticated user object
 *   - req.query: { limit?: number, cursor?: ObjectId string }
 */
export const getStarredItems = (model) => {
  return async (req, res, next) => {
    const lim = parseInt(req.query?.limit);
    const limit = lim > 0 && lim <= 100 ? lim : 50;

    const cursor = req.query?.cursor;
    if (cursor && !mongoose.isValidObjectId(cursor))
      return next(getErrorObject("Invalid cursor."));

    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    if (!Model) next("No `model` param found.");

    const projectionStr =
      "userId parentId name mime size isDeleted isStarred createdAt updatedAt";
    const query = { userId: req.user._id, isDeleted: false, isStarred: true };

    if (cursor) query._id = { $gt: cursor };
    try {
      let items = await Model.find(query)
        .sort({ _id: 1 })
        .limit(limit)
        .populate("userId", "_id name", { isDeleted: false })
        .lean();

      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;

      const itemDocs = items.map((f) => getFileDoc(f));
      return res
        .status(200)
        .json({ success: true, data: { items: itemDocs, nextCursor } });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/user/shared-with-me/files or /api/user/shared-with-me/dirs
 * what it do: Return paginated list of items shared with the authenticated user (via Permission records).
 * requirements:
 *   - model: "file" | "dir"
 *   - req.user: authenticated user object
 *   - req.query: { limit?: number, cursor?: ObjectId string }
 */
export const getSharedWith = (model) => {
  return async (req, res, next) => {
    const lim = parseInt(req.query?.limit);
    const limit = lim > 0 && lim <= 100 ? lim : 50;

    const cursor = req.query?.cursor;
    if (cursor && !mongoose.isValidObjectId(cursor))
      return next(getErrorObject("Invalid cursor."));

    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    const onModelType = model === "file" ? "UserFile" : "Directory";
    if (!Model) return next(getErrorObject("No `model` param found.", 400));

    try {
      // 1. Ask the ACL: "What item IDs do I have access to?"
      const permissions = await Permission.find({
        userId: req.user._id,
        onModel: onModelType,
      })
        .select("itemId")
        .lean();

      const sharedItemIds = permissions.map((p) => p.itemId);

      // 2. Fetch those specific items
      const projectionStr =
        "userId parentId name mime size createdAt updatedAt";
      const query = { _id: { $in: sharedItemIds }, isDeleted: false };
      if (cursor) query._id = { $gt: cursor };

      let items = await Model.find(query)
        .sort({ _id: 1 })
        .populate("userId", "_id name email avatarUrl")
        .limit(limit)
        .lean();
      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;

      const itemDocs = items.map((f) => getFileDoc(f));
      return res.status(200).json({
        success: true,
        data: { items: itemDocs, nextCursor },
      });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/user/shared-by-me/files or /api/user/shared-by-me/dirs
 * what it do: Return paginated list of items the authenticated user has shared with others.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.user: authenticated user object
 *   - req.query: { limit?: number, cursor?: ObjectId string }
 */
export const getSharedBy = (model) => {
  return async (req, res, next) => {
    const lim = parseInt(req.query?.limit);
    const limit = lim > 0 && lim <= 100 ? lim : 50;

    const cursor = req.query?.cursor;
    if (cursor && !mongoose.isValidObjectId(cursor))
      return next(getErrorObject("Invalid cursor."));

    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    const onModelType = model === "file" ? "UserFile" : "Directory";
    if (!Model) return next(getErrorObject("No `model` param found.", 400));

    try {
      const itemsIShared = await Permission.distinct("itemId", {
        grantedBy: req.user._id,
        onModel: onModelType,
      }).lean();

      const projectionStr =
        "userId parentId name mime size isDeleted isStarred createdAt updatedAt";

      const query = {
        $or: [
          { _id: { $in: itemsIShared } },
          { userId: req.user._id, publicRole: { $in: ["view", "edit"] } },
        ],
        isDeleted: false,
      };

      if (cursor) query._id = { $gt: cursor };

      let items = await Model.find(query)
        .sort({ _id: 1 })
        .populate("userId", "_id name email avatarUrl")
        .populate("path", "_id name")
        .limit(limit)
        .lean();
      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;

      const itemDocs = items.map((f) => getFileDoc(f));

      return res
        .status(200)
        .json({ success: true, data: { items: itemDocs, nextCursor } });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/user/recents/files or /api/user/recents/dirs
 * what it do: Return paginated list of recently updated items (within `days` days) for the authenticated user.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.user: authenticated user object
 *   - req.query: { limit?: number, cursor?: ObjectId string, days?: number (default 7) }
 */

export const getRecentItems = (model) => {
  return async (req, res, next) => {
    const lim = parseInt(req.query?.limit);
    const limit = lim > 0 && lim <= 100 ? lim : 50;

    const cursor = req.query?.cursor;
    if (cursor && !mongoose.isValidObjectId(cursor))
      return next(getErrorObject("Invalid cursor."));

    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    if (!Model) next("No `model` param found.");

    try {
      const userId = req.user._id;

      // Calculate the cutoff date
      // If req.body.days is 3, we go back 3 days. Default is 7.
      const days = parseInt(req.query?.days) || 7;
      const cutoffDate = new Date(Date.now() - days * 24 * 3600 * 1000);

      const projectionStr =
        "userId parentId name mime size createdAt updatedAt";
      const query = {
        $and: [{ _id: { $ne: req.user.root } }],
        userId,
        isDeleted: false,
        updatedAt: { $gte: cutoffDate },
      };
      if (cursor) query.$and.push({ _id: { $gt: cursor } });

      let items = await Model.find(query)
        .populate("userId", "_id name")
        .populate("path", "_id name")
        .sort({ _id: -1 })
        .limit(limit)
        .lean();
      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;

      const itemDocs = items.map((f) => getFileDoc(f));
      return res
        .status(200)
        .json({ success: true, data: { items: itemDocs, nextCursor } });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/user/search/files or /api/user/search/dirs
 * what it do: Search files or directories by name for the authenticated user. Factory pattern.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.user: authenticated user object
 *   - req.query: { q: string, limit?: number, cursor?: ObjectId string }
 */
export const searchItems = (model) => {
  return async (req, res, next) => {
    const q = req.query?.q?.trim();
    if (!q) return next(getErrorObject("Search query is required.", 400));

    const lim = parseInt(req.query?.limit);
    const limit = lim > 0 && lim <= 100 ? lim : 50;

    const cursor = req.query?.cursor;
    if (cursor && !mongoose.isValidObjectId(cursor))
      return next(getErrorObject("Invalid cursor."));

    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    if (!Model) return next(getErrorObject("No `model` param found.", 400));

    const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRegex = new RegExp(escapedQ, "i");
    const projectionStr =
      "userId parentId name mime size extension createdAt updatedAt";

    try {
      const query = {
        userId: req.user._id,
        _id: { $ne: req.user.root._id },
        isDeleted: false,
        name: nameRegex,
      };
      if (cursor) query._id = { $gt: cursor };

      let items = await Model.find(query)
        .populate("path", "_id name")
        .populate("userId", "_id name email avatarUrl")
        .sort({ _id: 1 })
        .limit(limit)
        .lean();

      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;

      const itemDocs = items.map((f) => getFileDoc(f));
      return res
        .status(200)
        .json({ success: true, data: { items: itemDocs, nextCursor } });
    } catch (err) {
      next(err);
    }
  };
};
