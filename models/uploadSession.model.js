import mongoose from "mongoose";

const UploadSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    fileName: {
      type: String,
      required: true,
    },

    size: {
      type: Number,
      required: true,
    },

    mime: {
      type: String,
    },

    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    strategy: {
      type: String,
      enum: ["direct", "chunked"],
      required: true,
    },

    status: {
      type: String,
      enum: [
        "initiated",
        "uploading",
        "paused",
        "uploaded",
        "completed",
        "failed",
      ],
      default: "initiated",
      index: true,
    },

    // chunk-specific
    chunkSize: Number,
    totalChunks: Number,
    uploadedChunks: {
      type: [Number], // [0, 1, 2, 5...]
      default: [],
    },

    tempDir: {
      type: String, // /uploads/tmp/<uploadId>/
    },

    expiresAt: {
      type: Date,
      index: { expireAfterSeconds: 0 }, 
    },
  },
  { timestamps: true }
);

export const UploadSession =  mongoose.model("UploadSession", UploadSessionSchema);
