import { Schema, model } from "mongoose";
import * as bcrypt from "bcrypt";

const otpSchema = Schema(
  {
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
      enum: ["login", "register", "forgotPassword"],
    },

    isVerified: {
      type: Boolean,
      default: false,
    },

    createdAt: {
      type: Date,
      default: Date.now,
      index: { expireAfterSeconds: 300 },
    },
  },
  { timeStamps: true }
);

otpSchema.pre("save", async function () {
  if (!this.isModified("otp")) return;
  this.otp = await bcrypt.hash(this.otp, 10);
});

otpSchema.methods.compareOTP = async function (userOtp) {
  return await bcrypt.compare(userOtp, this.otp);
};

export const OTP = model("OTP", otpSchema);
