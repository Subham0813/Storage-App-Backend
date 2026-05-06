import { Schema, model } from "mongoose";

const directorySchema = new Schema(
  {
    name: {
      type: String,
      minLength: 1,
      maxLength: 255,
      match: [/^[^\\/:*?"<>|]+$/, "Invalid folder name."],
      default: "Untitled Folder",
      required: true,
      trim: true,
    },

    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Directory",
      default: null,
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    ancestors: [{ type: Schema.Types.ObjectId, ref: "Directory", index: true }],
    size: { type: Number, default: 0 },
    isStarred: { type: Boolean, default: false },

    isDeleted: { type: Boolean, default: false },
    deletedBy: {
      type: String,
      enum: ["none", "user", "process"],
      default: "none",
    },
    deletedAt: { type: Date, default: null, expires: 15 * 24 * 3600 },

    // Public Link Sharing Only
    publicRole: {
      role: { type: String, enum: ["view", "none"], default: "none" },
      sharedAt: { type: Date, default: null },
      shareToken: { type: String, default: null },
    },
  },
  { strict: "throw", timestamps: true },
);

// Indexes for fast lookups
directorySchema.index({ parentId: 1, isDeleted: 1 });
directorySchema.index({ userId: 1, isDeleted: 1 });

export const Directory = model("Directory", directorySchema);
