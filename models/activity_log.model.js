import { Schema, model } from "mongoose";

const ACTIVITY_ACTIONS = [
  "upload",
  "copy",
  "rename",
  "move",
  "trash",
  "restore",
  "delete",
  "star",
  "unstar",
  "share",
  "create_directory",
];

const activityLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, enum: ACTIVITY_ACTIONS, required: true },
    itemType: {
      type: String,
      enum: ["file", "directory"],
      required: true,
    },
    itemId: { type: Schema.Types.ObjectId, required: true },
    itemName: { type: String },
    parentId: { type: Schema.Types.ObjectId },
    targetName: { type: String, maxlength: 500 },
  },
  { strict: "throw", timestamps: true }
);

activityLogSchema.index({ userId: 1, createdAt: -1 });
activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1296000 });

export const ActivityLog = model("ActivityLog", activityLogSchema);
