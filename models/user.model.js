import { Schema, model } from "mongoose";
import * as bcrypt from "bcrypt";
import { decryptToken, encryptToken } from "../utils/encryption.js";

const userSchema = new Schema(
  {
    root: { type: Schema.Types.ObjectId, ref: "Directory" },
    integrations: {
      googleDrive: {
        accessToken: { type: String, set: encryptToken, get: decryptToken },
        refreshToken: { type: String, set: encryptToken, get: decryptToken },
        scope: String,
        idToken: String,
        expiryDate: Date,
        tokenExpiry: Date,
      },
      github: {
        accessToken: { type: String, set: encryptToken, get: decryptToken },
        refreshToken: { type: String, set: encryptToken, get: decryptToken },
        tokenExpiry: Date,
      },
      dropbox: {
        accessToken: { type: String, set: encryptToken, get: decryptToken },
        refreshToken: { type: String, set: encryptToken, get: decryptToken },
        tokenExpiry: Date,
      },
      onedrive: {
        accessToken: { type: String, set: encryptToken, get: decryptToken },
        refreshToken: { type: String, set: encryptToken, get: decryptToken },
        tokenExpiry: Date,
      },
    },

    name: {
      type: String,
      minLength: [3, "fullname should be more than 3 characters long."],
      maxLength: [50, "fullname should not be more than 50 characters long."],
      trim: true,
      match: [
        /^(?!\s*(?:undefined|null|na|n\/a|none|unknown|test)\s*$)[A-Za-z ]{3,50}$/i,
        "Name must not be a placeholder value and must be between 3-50 characters.",
      ],
    },
    email: {
      type: String,
      // required: true,
      // match: [
      //   /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      //   "please enter a valid email.",
      // ],
      lowercase: true,
      trim: true,
      unique: true,
    },
    password: {
      type: String,
      // required: true,
      minLength: [8, "password should atleast 8 characters long."],
      select: false,
    },

    isTwoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },

    avatarKey: { type: String, default: "" },

    googleId: { type: String },
    githubId: { type: String },
    authProviders: {
      type: [String],
      enum: ["email", "google", "github"],
      required: true,
      default: ["email"],
    },

    role: {
      type: String,
      enum: ["super_admin", "admin", "manager", "user"],
      default: "user",
    },
    plan: {
      type: String,
      enum: [
        "FREE",
        "PRO_MONTHLY",
        "PRO_YEARLY",
        "BUSINESS_MONTHLY",
        "BUSINESS_YEARLY",
      ],
      default: "FREE",
    },
    subscription: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
    },
    subscriptionExpiresAt: { type: Date },

    maxQuota: { type: Number, default: null },

    usedBandwidthQuota: { type: Number, default: 0 },
    maxBandwidthQuota: { type: Number, default: null },
    bandwidthResetAt: { type: Date },

    lastLogin: { type: Date, default: Date.now },
    lastActiveAt: { type: Date },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { strict: "throw", timestamps: true },
);

userSchema.pre("save", async function () {
  // Hash password
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});

userSchema.methods.comparePassword = async function (userPassword) {
  return await bcrypt.compare(userPassword, this.password);
};

export const User = model("User", userSchema);
