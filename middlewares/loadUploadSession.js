import { UploadSession } from "../models/uploadSession.model.js";
import mongoose from "mongoose";

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
    return res.status(400).json({ message: "Invalid sessionId." });
  }

  try {
    const upSession = await UploadSession.findById(sessionId)
      .populate("parentId", "_id userId publicRole sharedWith")
      .select("-__v -createdAt -updatedAt")
      .lean();

    if (!upSession) {
      return res.status(404).json({ message: "Upload session not found." });
    }

    // 🔐 security: ensure ownership
    if (!upSession.userId.equals(req.user._id)) {
      return res.status(401).json({ message: "Unauthorized upload session." });
    }

    req.uploadSession = upSession;
    next();
  } catch (err) {
    next(err);
  }
};
