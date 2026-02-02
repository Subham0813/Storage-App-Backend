import { Schema, model } from "mongoose";

const AncestorSchema = new Schema(
  {
    _id: {
      type: Schema.Types.ObjectId,
      ref: "Directory",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const fileSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    
    hash: {
      type: String,
      // match: [/^[a-f0-9]{64}$/, "hash pattern mismatched. "],
      required: true,
      unique: true,
    },

    hashAlgo: {
      type: String,
      enum: ["sha256"],
      default: "sha256",
    },

    objectKey: {
      type: String,
      required: true,
      // match: [
      //   /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      //   "Filename not match with the pattern!",
      // ],
      // unique: true,
    },

    detectedMime: {
      type: String,
      minLength: 1,
      required: true,
      trim: true,
    },

    size: {
      type: Number,
      min: 1,
      required: true,
    },

    refCount: {
      type: Number,
      min: 1,
      required: true,
    },
    
    storageProvider: {
      type: String,
      required: true,
      enum: ["local", "s3", "r2", "gcs"],
      default: "local",
    },
  },
  { strict: "throw", timestamps: true }
);

export const File = model("File", fileSchema);

