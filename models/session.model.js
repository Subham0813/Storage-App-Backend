import { Schema, model } from "mongoose";

const expiryInSeconds = 15 * 24 * 3600;

// const deviceSchema = new Schema({
//   ipAddress: { type: String },
//   name: { type: String },
//   platform: { type: String },
//   agent: { type: String },
// });

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    expiry: {
      type: String,
      default: () => new Date(Date.now() + expiryInSeconds * 1000),
    },

    // deviceInfo: { type: deviceSchema, default: {} },

    createdAt: { type: Date, expires: expiryInSeconds, default: Date.now },
  },
  { strict: "throw", timestamps: true },
);

export const Session = model("Session", sessionSchema);
