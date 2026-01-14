import { Schema, model } from "mongoose";

const AncestorSchema = new Schema(
  {
    _id: {
      type: Schema.Types.ObjectId,
      ref: "Directory",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const directorySchema = new Schema(
  {
    name: {
      type: String,
      minLength: 1,
      maxLength: 255,
      match: [/^[^\\\\/:*?"<>|]+$/, "Invalid folder name."],
      default: "Untitled Folder",
      required: true,
      trim: true,
    },

    parentId: { type: Schema.Types.ObjectId, ref: "directory", default: null },

    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    isDeleted: { type: Boolean, required: true, default: false },

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
  },
  { strict: "throw", timestamps: true }
);

export const Directory = model("Directory", directorySchema);
