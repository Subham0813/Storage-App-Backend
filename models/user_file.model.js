import { Schema, model } from "mongoose";

const fileSchema = new Schema(
  {
    type: { type: String, default: "file" },
    path: [{ type: Schema.Types.ObjectId, ref: "Directory", required: true }],

    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    parentId: { type: Schema.Types.ObjectId, ref: "Directory", required: true },

    key: { type: String },
    thumbnailKey: { type: String },
    webviewLink: { type: String },
    // versionId: { type: String },

    name: {
      type: String,
      minLength: [1, "originalname should be atleast one character long."],
      maxLength: [
        255,
        "originalname should not be more than 255 characters long.",
      ],
      required: true,
      trim: true,
    },
    extension: { type: String, trim: true, required: true },
    mime: { type: String, trim: true, required: true },
    size: { type: Number, required: true },

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
fileSchema.index({ parentId: 1, isDeleted: 1 });
fileSchema.index({ userId: 1, isDeleted: 1 });

export const UserFile = model("UserFile", fileSchema);
