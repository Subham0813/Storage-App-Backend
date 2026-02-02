import { Schema, model } from "mongoose";

export const sharedWithSchema = new Schema({
  email: {
    type: String,
    match: [
      /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      "please enter a valid email.",
    ],
    lowercase: true,
    trim: true,
    required: true,
  },

  permissions: {
    type: String,
    enum: [
      "VIEWER",
      "COMMENTER",
      "EDITOR",
    ] /*VIEWER - only read, COMMENTER- read, add comment, EDITOR - read,update, */,
    required: true,
  },

  sharedAt: { type: Date, default: Date.now(), require: true },
});

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

    parentId: { type: Schema.Types.ObjectId, ref: "Directory", required: true },

    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    size: { type: Number, default: 0 },

    isDeleted: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },

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
      enum: ["VIEWER", "COMMENTER", "EDITOR", "OWNER"],
      default: "OWNER",
    },
    sharedWith: { type: [sharedWithSchema], default: [] },
  },
  { strict: "throw", timestamps: true },
);

export const Directory = model("Directory", directorySchema);
