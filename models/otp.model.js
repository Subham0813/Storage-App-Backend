import { Schema, model } from "mongoose";
import * as bcrypt from "bcrypt";
import { TIME } from "../misc/constants.js";

const otpSchema = Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    email: {
      type: String,
      required: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        "please enter a valid email.",
      ],
      lowercase: true,
      trim: true,
    },

    otp: {
      type: String,
      required: true,
    },

    purpose: {
      type: String,
      required: true,
      enum: ["login", "register", "forgot-password"],
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    createdAt: {
      type: Date,
      default: Date.now,
      index: { expireAfterSeconds: TIME.FIVE_MINUTES / 1000 },
    },
  },
  { strict: "throw", timestamps: true },
);

otpSchema.pre("save", async function () {
  if (!this.isModified("otp")) return;
  this.otp = await bcrypt.hash(this.otp, 10);
});

otpSchema.methods.compareOTP = async function (userOtp) {
  return await bcrypt.compare(userOtp, this.otp);
};

export const OTP = model("OTP", otpSchema);
