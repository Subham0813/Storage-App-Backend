import { model, Schema } from "mongoose";

const UploadSessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      
    },

    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Directory",
      required: true,
    },

    fileName: { type: String, required: true },
    size: { type: Number, required: true },
    mime: { type: String, required: true },

    strategy: {
      type: String,
      enum: ["direct", "chunked", "google-drive"],
      required: true,
    },

    status: {
      type: String,
      enum: [
        "initiated",
        "uploading",
        "importing",
        "uploaded",
        "imported",
        "paused",
        "failed",
        "cancelled",
      ],
      default: "initiated",
    },
    //google-drive specific
    bytesRead: { type: Number, required: true , default:0},

    // chunk-specific
    chunkSize: { type: Number, required: true },
    totalChunks: { type: Number, required: true },
    uploadedChunks: { type: [Number], default: [] },

    tempDir: { type: String},

    expiresAt: {
      type: Date,
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true },
);

export const UploadSession = model("upload_sessions", UploadSessionSchema);
