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

const fileSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },

    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Directory",
      default: null,
    },

    meta: {
      type: Schema.Types.ObjectId,
      ref: "File",
      required: true,
    },

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

    mimetype: {
      type: String,
      minLength: 1,
      trim: true,
      required: true,
    },

    disposition: {
      type: String,
      enum: ["inline", "attachment"],
      trim: true,
      default: "attachment",
    },

    inline_preview: { type: Boolean },
    force_inline_preview: { type: Boolean },

    isDeleted: {
      type: Boolean,
      default: false,
    },

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

export const UserFile = model("user_files", fileSchema);
