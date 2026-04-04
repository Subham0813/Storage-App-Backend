import mongoose from "mongoose";
import { UploadSession } from "../models/uploadSession.model.js";
import { getErrorObject } from "../utils/helper.js";

/**
 * Middleware: loadUploadSession
 * what it do: Load upload session by id from req.params.sessionId, verify ownership by user, attach to req.uploadSession.
 * requirements:
 *   - req.params.sessionId: valid upload session ObjectId
 *   - req.user: authenticated user object provided by validateSession
 *   - Upload session must belong to authenticated user (ownership check)
 *   - Sets req.uploadSession to populated session document with parentId details
 */
export const loadUploadSession = async (req, res, next) => {
  const { sessionId } = req.params;

  if (!mongoose.isValidObjectId(sessionId)) {
    return next(getErrorObject("Invalid id"));
  }

  try {
    const upSession = await UploadSession.findById(sessionId)
      .populate("parentId", "_id userId publicRole sharedWith")
      .select("-__v -createdAt -updatedAt")
      .lean();

    if (!upSession) {
      return next(getErrorObject("Session not found", 404));
    }

    if (!upSession.userId.equals(req.user._id))
      return next(getErrorObject("Unauthorized: Access denied.", 401));

    req.uploadSession = upSession;
    next();
  } catch (err) {
    next(err);
  }
};
