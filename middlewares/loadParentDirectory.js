import mongoose from "mongoose";
import { Directory } from "../models/directory.model.js";
import { getErrorObject, hasAccess } from "../utils/helper.js";

/**
 * Middleware: loadParentDir
 * what it do: Load parent directory from req.body.targetId, verify user has ownership or edit access, attach to req.parentDir.
 * requirements:
 *   - req.body.targetId: valid directory id (Mongo ObjectId)
 *   - req.user: authenticated user object provided by validateSession
 *   - User must be owner or have edit role on target directory
 *   - Sets req.parentDir to the validated directory document
 */
export const loadParentDir = async (req, res, next) => {
  const { targetId } = req.body;
  if (!mongoose.isValidObjectId(targetId))
    return next(getErrorObject("Invalid id"));

  try {
    const target = await Directory.findOne({
      _id: targetId,
      isDeleted: false,
    })
      .populate("userId", "allotedStorage usedStorage")
      .lean();

    if (!target)
      return next(getErrorObject("Target directory not exists.", 404));
    const isOwner = target.userId._id.toString() === req.user._id.toString();
    const isShared = req.user.email
      ? hasAccess(target, ["edit"], req.user.email)
      : false;

    if (!isShared && !isOwner)
      return next(getErrorObject("You do not have this permission", 403));
    req.parent = target;
    next();
  } catch (err) {
    next(err);
  }
};
