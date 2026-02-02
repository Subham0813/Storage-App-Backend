import { UploadSession } from "../models/uploadSession.model.js";
import mongoose from "mongoose";

const loadUploadSession = async (req, res, next) => {
  const { sessionId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ message: "Invalid sessionId" });
  }

  const upload = await UploadSession.findById(sessionId);

  if (!upload) {
    return res.status(404).json({ message: "Upload session not found" });
  }

  // 🔐 security: ensure ownership
  if (!upload.userId.equals(req.user._id)) {
    return res.status(403).json({ message: "Unauthorized upload session" });
  }

  req.uploadSession = upload;
  next();
};

export { loadUploadSession };
