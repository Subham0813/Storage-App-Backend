import { Schema, model } from "mongoose";
import * as bcrypt from "bcrypt";

const userSchema = new Schema(
  {
    rootDirId: { type: Schema.Types.ObjectId, ref: "Directory" },

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
    username: {
      type: String,
      unique: true,
    },
    avatar: {
      type: String,
      default: "../public/favicon.ico",
    },
    role: {
      type: String,
      enum: ["SUPER_ADMIN","ADMIN", "GUEST", "USER"],
      default: "GUEST",
    },

    googleId: { type: String },
    githubId: { type: String },
    authProvider: {
      type: [String],
      enum: ["email", "google", "github"],
      required: true,
      default: ["email"],
    },
    emailVerified: { type: Boolean, default: false },
    theme: { type: String, default: "Light" },

    deviceCount: {
      type: Number,
      default: 0,
    },

    allotedStorage: { type: Number, default: 1024 * 1024 * 1024 * 10 },
    usedStorage: { type: Number, default: 0 },

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

  // Set username if it doesn't exist
  if (this.email && !this.username) {
    this.username = this.email.split("@")[0];
  }
});

userSchema.methods.comparePassword = async function (userPassword) {
  return await bcrypt.compare(userPassword, this.password);
};

export const User = model("User", userSchema);
