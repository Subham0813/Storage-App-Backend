import mongoose from "mongoose";
import { Directory } from "../models/directory.model.js";
import { Permission } from "../models/permission.model.js";
import { getErrorObject } from "../utils/helper.js";
import { redisClient } from "../configs/redis.js";

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
          select: "_id name email maxQuota root plan",
          populate: { path: "root", select: "size" },
        })
        .select("userId path publicRole dirname")
        .lean();

      if (!target)
        return next(getErrorObject("Target directory not found.", 404));

      const isOwner = target.userId._id.toString() === req.user._id.toString();

      if (!isOwner) {
        // ACL Check for Write Access
        // const allItemsToCheck = [...(target.path || []), target._id];
        // const hasAccess = await Permission.exists({
        //   userId: req.user._id,
        //   itemId: { $in: allItemsToCheck },
        //   permission: { $in: ["edit"] },
        // });

        // if (!hasAccess)
        return next(
          getErrorObject(
            "Unauthorized to write to this directory. Owner access required.",
            403,
          ),
        );
      }

      const record = {
        _id: target._id.toString(),
        path: target.path,
        userId: target.userId,
        publicRole: target.publicRole,
      };

      await redisClient.json.set(targetKey, "$", record);
      await redisClient.expire(targetKey, 30);
      target = record;
    }

    if (!target.path.includes(target._id.toString())) {
      target.path.push(target._id.toString());
    }

    req.parent = target; 
    req.target = target; 
    next();
  } catch (err) {
    next(err);
  }
};
