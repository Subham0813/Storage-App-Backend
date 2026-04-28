import { Schema, model } from "mongoose";

export const shared = {
  email: { type: String, lowercase: true, trim: true, required: true },
  role: { type: String, enum: ["view", "edit"], required: true },
};

const directorySchema = new Schema(
  {
    dirname: {
      type: String,
      minLength: 1,
      maxLength: 255,
      match: [/^[^\\\\/:*?"<>|]+$/, "Invalid folder name."],
      default: "Untitled Folder",
      required: true,
      trim: true,
    },
    parentId: { type: Schema.Types.ObjectId, ref: "Directory", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    size: { type: Number, default: 0 },
    isStarred: { type: Boolean, default: false },

    isDeleted: { type: Boolean, default: false },
    deletedBy: {
      type: String,
      enum: ["none", "user", "process"],
      default: "none",
    },

    deletedAt: {
      type: Date,
      default: null,
      expires: 15 * 24 * 3600,
    },

    publicRole: {
      type: String,
      enum: ["view", "none"],
      default: "none",
    },
    sharedBy: {
      type: String,
      enum: ["none", "user", "process"],
      default: "none",
    },
    sharedWith: { type: [shared], default: [] },
    sharedAt: { type: Date, default: null },
    shareToken: { type: String },
  },
  { strict: "throw", timestamps: true },
);

export const Directory = model("Directory", directorySchema);
