import { model, Schema } from "mongoose";

const permissionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true, // Fast lookups for "Show me everything shared with me"
    },
    itemId: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "onModel",
      index: true, // Fast lookups for "Show me everyone who has access to this file"
    },
    onModel: {
      type: String,
      enum: ["Directory", "UserFile"],
      required: true,
    },

    permission: {
      type: String,
      enum: ["view", "edit"],
      default: "view",
    },
    grantedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

// A user can only have ONE permission record per item.
permissionSchema.index({ userId: 1, itemId: 1 }, { unique: true });

export const Permission = model("Permission", permissionSchema);
