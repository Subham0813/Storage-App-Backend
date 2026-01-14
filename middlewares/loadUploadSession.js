import { UploadSession } from "../models/uploadSession.model.js";
import mongoose from "mongoose";

const loadUploadSession = async (req, res, next) => {
  const { uploadId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(uploadId)) {
    return res.status(400).json({ message: "Invalid uploadId" });
  }

  const upload = await UploadSession.findById(uploadId);

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
