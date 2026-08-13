import { model, Schema } from "mongoose";

const subscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    razorpaySubscriptionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    planId: { type: String, required: true },
    planKey: {
      type: String,
      enum: [
        "PRO_MONTHLY",
        "PRO_YEARLY",
        "ULTRA_MONTHLY",
        "ULTRA_YEARLY",
        "PREMIUM_MONTHLY",
        "PREMIUM_YEARLY",
        "ELITE_MONTHLY",
        "ELITE_YEARLY",
      ],
      required: true,
    },
    status: {
      type: String,
      // enum: ["created","active","completed","cancelled","halted","past_due",],
      default: "created",
    },

    price: { type: Number, required: true },
    paidCount: { type: Number },
    shortUrl: { type: String },
    invoiceUrl: { type: String },

    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },

    endedAt: { type: Date },
    cancelAtPeriodEnd: { type: Boolean },
    cancelReason: { type: String },

    limits: {
      quotaBytes: { type: Number, required: true },
      maxFileSize: { type: Number, required: true },
      chunkSize: { type: Number, required: true },
      monthlyBandwidthLimit: { type: Number, required: true },
      maxUploadConcurrency: { type: Number, required: true },
      maxDevices: { type: Number, required: true },
      canCreatePublicLinks: { type: Boolean, required: true },
      trashRetentionDays: { type: Number, required: true },
      gracePeriod: { type: Number, required: true },
    },
  },
  { timestamps: true },
);

subscriptionSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 86400, // 24 hours
    partialFilterExpression: { status: "created" }, // ONLY delete if they never paid
  },
);

export const Subscription = model("Subscription", subscriptionSchema);
