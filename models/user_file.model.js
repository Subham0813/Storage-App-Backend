import { Schema, model } from "mongoose";

const fileSchema = new Schema(
  {
    ancestors: [
      { type: Schema.Types.ObjectId, ref: "Directory", required: true },
    ],

    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    parentId: { type: Schema.Types.ObjectId, ref: "Directory", required: true },

    key: { type: String, required: true },
    webViewLink: { type: String, default: "" },

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
    mime: { type: String, trim: true, required: true },

    size: { type: Number, required: true },

    isStarred: { type: Boolean, required: true, default: false },

    isDeleted: { type: Boolean, required: true, default: false },

    deletedBy: {
      type: String,
      enum: ["none", "user", "process"],
      required: true,
      default: "none",
    },
    deletedAt: {
      type: Date,
      default: null,
      expires: 15 * 24 * 3600, // 15 Days
    },

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
fileSchema.index({ parentId: 1, isDeleted: 1 });
fileSchema.index({ userId: 1, isDeleted: 1 });

export const UserFile = model("UserFile", fileSchema);
