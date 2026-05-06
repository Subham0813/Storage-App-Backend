import mongoose from "mongoose";
import { Directory } from "../models/directory.model.js";
import { Permission } from "../models/permission.model.js";
import { getErrorObject } from "../utils/helper.js";
import { redisClient } from "../configs/radis.js";

export const loadParentDir = async (req, res, next) => {
  const targetId = req.body.targetId || req.body.parentId; // Support both
  if (!mongoose.isValidObjectId(targetId))
    return next(getErrorObject("Invalid target id"));

  try {
    const targetKey = `storageApp:user:${req.user._id.toString()}:target:${targetId}`;
    let target = await redisClient.json.get(targetKey);

    if (!target) {
      target = await Directory.findById(targetId)
        .populate({
          path: "userId",
          select: "maxQuota root",
          populate: { path: "root", select: "size" },
        })
        .select("userId ancestors publicRole dirname")
        .lean();

      if (!target)
        return next(getErrorObject("Target directory not found.", 404));

      const isOwner = target.userId._id.toString() === req.user._id.toString();

      if (!isOwner) {
        // ACL Check for Write Access
        const allItemsToCheck = [...(target.ancestors || []), target._id];
        const hasAccess = await Permission.exists({
          userId: req.user._id,
          itemId: { $in: allItemsToCheck },
          permission: { $in: ["edit"] },
        });

        if (!hasAccess)
          return next(
            getErrorObject("Unauthorized to write to this directory.", 403),
          );
      }

      const record = {
        _id: target._id.toString(),
        ancestors: target.ancestors,
        userId: target.userId,
        publicRole: target.publicRole,
      };

      await redisClient.json.set(targetKey, "$", record);
      await redisClient.expire(targetKey, 30);
      target = record;
    }

    if (!target.ancestors.includes(target._id.toString())) {
      target.ancestors.push(target._id.toString());
    }

    req.parent = target; // Ensure controllers use req.parent!
    req.target = target; // Fallback for your upload controllers
    next();
  } catch (err) {
    next(err);
  }
};
