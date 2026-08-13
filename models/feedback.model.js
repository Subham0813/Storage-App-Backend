import { Schema, model } from "mongoose";

const feedbackSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: ["upload", "preview", "sharing", "billing", "performance", "other"],
    },
    title: {
      type: String,
      required: true,
      minLength: [5, "Title must be at least 5 characters."],
      maxLength: [200, "Title cannot exceed 200 characters."],
      trim: true,
    },
    description: {
      type: String,
      required: true,
      minLength: [10, "Description must be at least 10 characters."],
      maxLength: [2000, "Description cannot exceed 2000 characters."],
      trim: true,
    },
    screenshotKey: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "reviewed", "resolved"],
      default: "pending",
    },
    adminNotes: {
      type: String,
      default: null,
    },
  },
  { strict: "throw", timestamps: true }
);

feedbackSchema.index({ userId: 1, createdAt: -1 });
feedbackSchema.index({ status: 1 });

export const Feedback = model("Feedback", feedbackSchema);