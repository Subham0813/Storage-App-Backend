import { Schema, model } from "mongoose";
import * as bcrypt from "bcrypt";

const userSchema = new Schema(
  {
    root: { type: Schema.Types.ObjectId, ref: "Directory" },
    integrations: {
      googleDrive: {
        accessToken: String,
        refreshToken: String,
        tokenExpiry: Date,
      },
      github: {
        accessToken: String,
        refreshToken: String,
        tokenExpiry: Date,
      },
      dropbox: {
        accessToken: String,
        refreshToken: String,
        tokenExpiry: Date,
      },
      onedrive: {
        accessToken: String,
        refreshToken: String,
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
    avatar: { type: String, default: "" },
    role: {
      type: String,
      enum: ["super_admin", "admin", "manager", "user"],
      default: "user",
    },
    tier: {
      type: String,
      enum: ["free", "lite", "plus", "pro", "super"],
      default: "free",
    },

    googleId: { type: String },
    githubId: { type: String },
    authProviders: {
      type: [String],
      enum: ["email", "google", "github"],
      required: true,
      default: ["email"],
    },
    theme: { type: String, default: "Light" },
    deviceCount: { type: Number, default: 0 },
    maxQuota: { type: Number, default: 1024 * 1024 * 1024 },
    isLogged: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
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
