// GoogleIntegration {
//     userId,
//     provider: "google-drive",
//     accessToken,
//     refreshToken,
//     scope,
//     expiresAt,
//     connectedAt
//   }

import { Schema, model } from "mongoose";

const driveIntegrationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    state: { type: String },
    stateCreatedAt: {
      type: Date,
      default: Date.now,
      index: { expireAfterSeconds: 0 },
    },
    provider: {
      type: String,
      enum: ["google-drive"],
      required: true,
    },
    accessToken: { type: String },
    refreshToken: { type: String },
    scope: {
      type: [String],
      required: true,
    },
    connectedAt: {
      type: Date,
      default: Date.now,
    },
    expiresIn: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

export const DriveIntegration = model(
  "drive_integrations",
  driveIntegrationSchema,
);
