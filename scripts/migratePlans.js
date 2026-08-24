import mongoose from "mongoose";
import connectMongoose from "../configs/connect.js";
import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import { PLAN_DETAILS } from "../misc/constants.js";

const PLAN_MAP = {
  START_MONTHLY: "FREE",
  START_YEARLY: "FREE",
  STANDARD_MONTHLY: "PRO_MONTHLY",
  STANDARD_YEARLY: "PRO_YEARLY",
  POWER_MONTHLY: "BUSINESS_MONTHLY",
  POWER_YEARLY: "BUSINESS_YEARLY",
  MAX_MONTHLY: "BUSINESS_MONTHLY",
  MAX_YEARLY: "BUSINESS_YEARLY",
  ULTRA_MONTHLY: "BUSINESS_MONTHLY",
  ULTRA_YEARLY: "BUSINESS_YEARLY",
  LITE_MONTHLY: "FREE",
  LITE_YEARLY: "FREE",
  PREMIUM_MONTHLY: "BUSINESS_MONTHLY",
  PREMIUM_YEARLY: "BUSINESS_YEARLY",
  ELITE_MONTHLY: "BUSINESS_MONTHLY",
  ELITE_YEARLY: "BUSINESS_YEARLY",
};

const OLD_PLANS = Object.keys(PLAN_MAP);

const LIMITS_FIELDS = [
  "quotaBytes",
  "maxFileSize",
  "chunkSize",
  "monthlyBandwidthLimit",
  "maxUploadConcurrency",
  "maxDevices",
  "canCreatePublicLinks",
  "trashRetentionDays",
  "gracePeriod",
];

async function migrate() {
  await connectMongoose();

  const users = await User.find({}).lean();
  console.info(`Found ${users.length} users.`);

  let migrated = 0;
  let synced = 0;

  for (const user of users) {
    const isLegacy = OLD_PLANS.includes(user.plan);
    const newPlan = PLAN_MAP[user.plan] || user.plan;
    const limit = PLAN_DETAILS[newPlan];
    if (!limit) continue;

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          plan: newPlan,
          maxQuota: limit.quotaBytes,
          maxBandwidthQuota: limit.monthlyBandwidthLimit,
        },
      },
    );
    await Subscription.updateMany(
      {
        user: user._id,
        planKey: { $in: isLegacy ? OLD_PLANS : [user.plan] },
        status: { $in: ["created", "active", "completed", "halted", "past_due"] },
      },
      {
        $set: {
          planKey: newPlan,
          price: limit.priceInRupees,
          planId: limit.planId,
          limits: Object.fromEntries(
            LIMITS_FIELDS.map((f) => [f, limit[f]]),
          ),
        },
      },
    );
    if (isLegacy) {
      migrated++;
      console.info(`✓ ${user.email} — ${user.plan} → ${newPlan}`);
    } else {
      synced++;
    }
  }

  console.info(
    `Migration complete: ${migrated} legacy migrated, ${synced} re-synced.`,
  );
}

migrate()
  .then(() => mongoose.disconnect())
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });