import mongoose from "mongoose";
import { Directory } from "../models/directory.model.js";
import { hasAccess } from "../utils/helper.js";
import { badRequest, forbidden, notFound } from "../utils/helper.js";

/**
 * Middleware: loadParentDir
 * what it do: Load parent directory from req.body.targetId, verify user has ownership or EDITOR access, attach to req.parentDir.
 * requirements:
 *   - req.body.targetId: valid directory id (Mongo ObjectId)
 *   - req.user: authenticated user object provided by validateSession
 *   - User must be owner or have EDITOR role on target directory
 *   - Sets req.parentDir to the validated directory document
 */
export const loadParentDir = async (req, res, next) => {
  const { targetId } = req.body;
  const { _id: userId, email } = req.user;

  if (!mongoose.isValidObjectId(targetId)) {
    return badRequest(res, "Invalid id.");
  }
  try {
    const target = await Directory.findOne({
      _id: targetId,
      isDeleted: false,
    }).lean();

    if (!target) return notFound("Target directory not exists.");

    const isOwner = target.userId.toString() === userId.toString();
    const isShared = email ? hasAccess(target, ["EDITOR"], email) : false;

    if (!isShared && !isOwner) return forbidden(res);

    req.parent = target;
    next();
  } catch (err) {
    next(err);
  }
};
