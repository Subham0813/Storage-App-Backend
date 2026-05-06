import mongoose from "mongoose";
import crypto from "crypto";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { getErrorObject } from "../utils/helper.js";
import { base64URLEncode } from "./oauthControllers.js";
import { Permission } from "../models/permission.model.js";

/**
 * path: /api/files/info/:id or /api/directories/info/:id
 * what it do: Return full metadata for a file or directory, including populated ancestors and owner.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.params: { id: string }
 *   - req.Item: item object populated by `checkAccess` middleware
 */
export const getItemInfo = (model) => {
  return async (req, res, next) => {
    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    if (!Model) return next(getErrorObject("No `model` param found.", 400));

    try {
      // req.Item is populated by checkAccess middleware!
      const item = await Model.findOne({ _id: req.Item._id, isDeleted: false })
        .select("-__v -deletedBy -deletedAt -key")
        .populate("userId", "-_id name email")
        .populate("ancestors", "_id name", { isDeleted: false })
        .lean();

      if (!item) return next(getErrorObject("Item not found.", 404));

      const { userId, publicRole, ...itemData } = item;
      if (itemData.ancestors.length < 1) itemData.parentId = null;
      return res.status(200).json({
        success: true,
        data: {
          item: { ...itemData, publicRole: publicRole.role, owner: userId },
        },
      });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/files/share-info/:id or /api/directories/share-info/:id
 * what it do: Return sharing state (Permission records + publicRole) for an item. Owner only.
 * requirements:
 *   - req.Item: item object populated by `checkAccess` middleware
 *   - req.user: authenticated user (must be item owner, no token/guest access)
 *   - req.query: { limit?: number, cursor?: ObjectId string }
 */
export const getShareInfo = async (req, res, next) => {
  if (req.tokenAuth) return next(getErrorObject("Unauthorized.", 403));

  const Item = req.Item;
  if (!Item) return next(getErrorObject("Item not found.", 404));

  if (Item.userId.toString() !== req.user._id.toString())
    return next(getErrorObject("Unauthorized.", 403));

  let limit = parseInt(req.query.limit) || 50;

  const cursor = req.query.cursor;
  if (cursor && !mongoose.isValidObjectId(cursor))
    return next(getErrorObject("Invalid cursor."));

  const query = { itemId: Item._id };
  if (cursor) query._id = { $gt: cursor };

  try {
    const items = await Permission.find(query)
      .populate("userId", "name email")
      // .populate("grantedBy", "name email")
      .sort({ _id: 1 })
      .limit(limit)
      .select("-_id userId permission")
      .lean();

    const nextCursor =
      items.length < limit ? null : items[items.length - 1]._id;
    return res.status(200).json({
      success: true,
      data: { items, publicRole: Item.publicRole, nextCursor },
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
    let limit = parseInt(req.query.limit) || 50;

    const cursor = req.query.cursor;
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
      const items = await Model.find(query)
        .sort({ _id: 1 })
        .limit(limit)
        .select(projectionStr)
        .lean();
      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;

      return res
        .status(200)
        .json({ success: true, data: { items, nextCursor } });
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
    let limit = parseInt(req.query.limit) || 50;

    const cursor = req.query.cursor;
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
      const items = await Model.find(query)
        .sort({ _id: 1 })
        .limit(limit)
        .populate("ancestors", "_id name", { isDeleted: false })
        .select(projectionStr)
        .lean();
      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;

      return res
        .status(200)
        .json({ success: true, data: { items, nextCursor } });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/user/shared-with/files or /api/user/shared-with/dirs
 * what it do: Return paginated list of items shared with the authenticated user (via Permission records).
 * requirements:
 *   - model: "file" | "dir"
 *   - req.user: authenticated user object
 *   - req.query: { limit?: number, cursor?: ObjectId string }
 */
export const getSharedWith = (model) => {
  return async (req, res, next) => {
    let limit = parseInt(req.query.limit) || 50;

    const cursor = req.query.cursor;
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

      const items = await Model.find(query)
        .sort({ _id: 1 })
        .populate("userId", "-_id name email")
        .select(projectionStr)
        .limit(limit)
        .lean();

      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;
      return res
        .status(200)
        .json({ success: true, data: { items, nextCursor } });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/user/shared/files or /api/user/shared/dirs
 * what it do: Return paginated list of items the authenticated user has shared with others.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.user: authenticated user object
 *   - req.query: { limit?: number, cursor?: ObjectId string }
 */
export const getSharedBy = (model) => {
  return async (req, res, next) => {
    let limit = parseInt(req.query.limit) || 50;

    const cursor = req.query.cursor;
    if (cursor && !mongoose.isValidObjectId(cursor))
      return next(getErrorObject("Invalid cursor."));

    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    const onModelType = model === "file" ? "UserFile" : "Directory";
    if (!Model) return next(getErrorObject("No `model` param found.", 400));

    try {
      // 1. Ask the ACL: "What item IDs have I granted permission for?"
      // `.distinct()` returns an array of unique itemIds!
      const itemsIShared = await Permission.distinct("itemId", {
        grantedBy: req.user._id,
        onModel: onModelType,
      });

      // 2. Fetch those specific items
      const projectionStr =
        "userId parentId name mime size createdAt updatedAt";
      const query = { _id: { $in: itemsIShared }, isDeleted: false };

      if (cursor) query._id = { $gt: cursor };

      const items = await Model.find(query)
        .sort({ _id: 1 })
        .select(projectionStr)
        .limit(limit)
        .lean();

      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;
      return res
        .status(200)
        .json({ success: true, data: { items, nextCursor } });
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
    let limit = parseInt(req.query.limit) || 50;

    const cursor = req.query.cursor;
    if (cursor && !mongoose.isValidObjectId(cursor))
      return next(getErrorObject("Invalid cursor."));

    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    if (!Model) next("No `model` param found.");

    try {
      const userId = req.user._id;

      // Calculate the cutoff date
      // If req.body.days is 3, we go back 3 days. Default is 7.
      const days = parseInt(req.query.days) || 7;
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

      const items = await Model.find(query)
        .sort({ _id: 1 })
        .select(projectionStr)
        .limit(limit)
        .lean();
      const nextCursor =
        items.length < limit ? null : items[items.length - 1]._id;

      return res
        .status(200)
        .json({ success: true, data: { items, nextCursor } });
    } catch (err) {
      next(err);
    }
  };
};
