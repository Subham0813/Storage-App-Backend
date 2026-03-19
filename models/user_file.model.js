import { Schema, model } from "mongoose";
import { sharedWithSchema } from "./directory.model.js";

const fileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    parentId: { type: Schema.Types.ObjectId, ref: "Directory", required: true },

    meta: { type: Schema.Types.ObjectId, ref: "File", default: null },
    linkMeta: {
      driveId: { type: String },
      fileId: { type: String },
      webViewLink: { type: String },
      // iconLink: { type: String },
    },

    filename: {
      type: String,
      minLength: [1, "originalname should be atleast one character long."],
      maxLength: [
        255,
        "originalname should not be more than 255 characters long.",
      ],
      required: true,
      trim: true,
    },
    mimetype: { type: String, trim: true, required: true },
    disposition: {
      type: String,
      enum: ["inline", "attachment"],
      trim: true,
      required: true,
      default: "attachment",
    },
    size: { type: Number, required: true },
    inline_preview: { type: Boolean, required: true },
    force_inline_preview: { type: Boolean, required: true },
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
      expires: 15 * 24 * 3600,
    },

    publicRole: {
      type: String,
      enum: ["VIEWER", "NONE"],
      default: "NONE",
    },
    sharedBy: {
      type: String,
      enum: ["none", "user", "process"],
      default: "none",
    },
    sharedWith: { type: [sharedWithSchema], default: [] },
    sharedAt: { type: Date, default: Date.now(), require: true },
    shareToken: { type: String, default: null },
  },
  { strict: "throw", timestamps: true },
);

export const UserFile = model("user_files", fileSchema);
