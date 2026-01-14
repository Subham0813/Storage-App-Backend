import { Schema, model } from "mongoose";

const expiryInSeconds = 15 * 24 * 3600;

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },

    expiry: {
      type: String,
      default: () => new Date(Date.now() + expiryInSeconds * 1000),
    },

    createdAt: { type: Date, expires: expiryInSeconds, default: Date.now },
  },
  { strict: "throw", timestamps: true }
);

export const Session = model("Session", sessionSchema);
