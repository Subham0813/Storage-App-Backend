import mongoose from "mongoose";
import Razorpay from "razorpay";
import crypto from "crypto";

import { PLAN_DETAILS, t } from "../misc/constants.js";
import { Subscription } from "../models/subscription.model.js";
import { User } from "../models/user.model.js";
import { redisClient } from "../configs/redis.js";
import { getBandwidthResetAt } from "../utils/bandwidthWindow.js";
import {
  getRazorpayInstance,
  retireOldSubscriptions,
} from "../controllers/subscriptionControllers.js";
import { sendInvoiceEmail } from "./emailService.js";

export const razorpayWebhook = async (req, res, next) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const webhookSecret =
      process.env.NODE_ENV === "production"
        ? process.env.RAZORPAY_WEBHOOK_SECRET
        : process.env.TEST_RAZORPAY_WEBHOOK_SECRET;

    const expectedSignature = crypto
      .createHmac("sha256", JSON.stringify(req.body))
      .update(webhookSecret)
      .digest("hex");
    console.log({ expectedSignature, signature });
    
    const isValidSignature = Razorpay.validateWebhookSignature(
      JSON.stringify(req.body),
      signature,
      webhookSecret,
    );

    if (!isValidSignature) {
      console.log("Webhook signature validation failed");
      return res.status(400).json({ status: "Invalid Signature" });
    }

    const event = req.body.event;
    const payload = req.body.payload.subscription.entity;
    const subId = payload.id;
    const userId = payload.notes?.userId;

    if (!userId) return res.status(200).end(); // Ignore events without our metadata

    const query = {
      status: payload.status,
      currentPeriodStart: payload.current_start
        ? new Date(payload.current_start * 1000)
        : undefined,
      currentPeriodEnd: payload.current_end
        ? new Date(payload.current_end * 1000)
        : undefined,
      paidCount: payload.paid_count,
      shortUrl: payload.short_url,
      endedAt: payload.ended_at ? new Date(payload.ended_at * 1000) : undefined,
      cancelReason: payload.cancel_reason,
    };

    Object.keys(query).forEach(
      (key) => query[key] === undefined && delete query[key],
    );

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updatedSub = await Subscription.findOneAndUpdate(
          { razorpaySubscriptionId: subId },
          { $set: query },
          { session, returnDocument: "after" },
        );

        // Cross-check ownership: only process events whose subscription record
        // belongs to the user referenced in the notes metadata.
        if (!updatedSub || updatedSub.user.toString() !== userId) return;

        switch (event) {
          case "subscription.charged":
          case "subscription.resumed":
            // Prefer the locally tracked plan (source of truth for scheduled
            // downgrades) over the stale `notes.plan` metadata from creation.
            const planKey = updatedSub.planKey;
            const planInfo = PLAN_DETAILS[planKey];
            if (planInfo && updatedSub) {
              const { quotaBytes } = planInfo;
              const isYearly = planKey.includes("YEARLY");
              const durationMs = isYearly
                ? 365 * t._day * 1000
                : 30 * t._day * 1000;

              // Capture the pre-update plan so we only start a fresh bandwidth
              // window on an actual plan change (scheduled downgrade executing,
              // upgrade activation via webhook), never on same-plan renewals.
              const existingPlan = (
                await User.findById(userId, { plan: 1 }).session(session).lean()
              )?.plan;
              const planChanged = !!existingPlan && existingPlan !== planKey;

              await User.updateOne(
                {
                  _id: userId,
                  isDeleted: { $ne: true },
                },
                {
                  plan: planKey,
                  maxQuota: quotaBytes,
                  maxBandwidthQuota: updatedSub.limits.monthlyBandwidthLimit,
                  subscriptionExpiresAt: Date.now() + durationMs,
                  subscription: updatedSub._id,
                  ...(planChanged && {
                    usedBandwidthQuota: 0,
                    bandwidthResetAt: getBandwidthResetAt(),
                  }),
                },
                { session },
              );

              if (payload.notes.isUpgrade === "true") {
                const oldSubId = payload.notes.oldSubId;
                try {
                  await getRazorpayInstance().subscriptions.cancel(oldSubId, 0); // Kill instantly
                  await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: oldSubId },
                    { status: "upgraded" },
                    { session },
                  );
                } catch (cleanupErr) {
                  console.error(
                    `🚨 Failed to clean up old sub ${oldSubId}:`,
                    cleanupErr,
                  );
                }
              }

              // Retire every other subscription record so background executors
              // (e.g. cancel-executor) never downgrade this active user.
              await retireOldSubscriptions(userId, updatedSub._id, session);
            }
            break;

          case "subscription.halted":
          case "subscription.cancelled":
          case "subscription.completed":
            break;

          case "invoice.paid":
            const invoiceEntity = req.body.payload.invoice.entity;
            const invoiceUrl = invoiceEntity.short_url; // Direct link to the Razorpay PDF
            const amountPaid = invoiceEntity.amount / 100; // Convert paise to rupees

            // The webhook payload for invoices usually includes the subscription_id
            const subIdForInvoice = invoiceEntity.subscription_id;

            if (subIdForInvoice) {
              const subRecord = await Subscription.findOneAndUpdate(
                { razorpaySubscriptionId: subIdForInvoice },
                { invoiceUrl },
                { returnDocument: "after" },
              )
                .populate("user", "email name")
                .session(session)
                .lean();

              if (subRecord && subRecord.user) {
                // Fire and forget the email
                sendInvoiceEmail(
                  subRecord.user.name,
                  subRecord.user.email,
                  subRecord.planKey,
                  amountPaid,
                  invoiceUrl,
                ).catch((err) => console.error("Invoice email failed:", err));
              }
            }
            break;

          default:
            break;
        }
      });
    } finally {
      session.endSession();
    }

    await redisClient.del(`storageApp:user:${userId}:userdata`);
    return res.status(200).end();
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.status(500).end();
  }
};
