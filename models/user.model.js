import { Schema, model } from "mongoose";
import * as bcrypt from "bcrypt";

const userSchema = new Schema(
  {
    fullname: {
      type: String,
      minLength: [3, "fullname should be more than 3 characters long."],
      maxLength: [100, "fullname should not be more than 50 characters long."],
      required: true,
      trim: true,
      match: [
        /^(?!\s*(?:undefined|null|na|n\/a|none|unknown|test)\s*$)[A-Za-z ]{3,100}$/i,
        "Fullname must not be a placeholder value and must be between 3-100 characters.",
      ],
    },
    email: {
      type: String,
      required: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        "please enter a valid email.",
      ],
      lowercase: true,
      trim: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      minLength: [8, "password should atleast 8 characters long."],
      select: false,
    },
    username: {
      type: String,
      default: "",
    },
    // profilePicture: {
    //   type: Buffer,
    // },
    deviceCount: {
      type: Number,
      default: 0,
    },

    // verified: { type: Boolean, default: false },
  },
  { strict: "throw", timestamps: true }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function (userPassword) {
  return await bcrypt.compare(userPassword, this.password);
};

//random userName, check used by other user before save
userSchema.pre("save", async function () {
  if (!this.email) return;
  this.username = this.email.split("@")[0];
});

export const User = model("User", userSchema);
