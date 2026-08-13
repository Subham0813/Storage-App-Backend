import { Schema, model } from "mongoose";

const directorySchema = new Schema(
  {
    type: {type: String, default: "directory"},
    name: {
      type: String,
      minLength: 1,
      maxLength: 255,
      match: [/^[^\\/:*?"<>|]+$/, "Invalid folder name."],
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
    path: [{ type: Schema.Types.ObjectId, ref: "Directory", index: true }],

    size: { type: Number, default: 0 },
    color: { type: String },

    isStarred: { type: Boolean, required: true, default: false },
    isDeleted: { type: Boolean, required: true, default: false },
    deletedBy: { type: String, enum: ["none", "user", "process"] },
    deletedAt: { type: Date },
    permanentDeleteAt: { type: Date },

    // Public Link Sharing Only
    publicRole: { type: String, enum: ["view", "none"] },
    publicBy: { type: Schema.Types.ObjectId, ref: "User" },
    sharedAt: { type: Date },
    shareToken: { type: String },
    shareLink: { type: String },
    shareTokenExpiresAt: { type: Date },

    accessCount: { type: Number, default: 0 },
    accessLevel: {
      type: String,
      enum: ["private", "shared", "public"],
      default: "private",
    },

    lastAccessedAt: { type: Date },
    lastModifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { strict: "throw", timestamps: true },
);

// Indexes for fast lookups
directorySchema.index({ parentId: 1, isDeleted: 1 });
directorySchema.index({ userId: 1, isDeleted: 1 });

export const Directory = model("Directory", directorySchema);
