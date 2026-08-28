import mongoose from "mongoose";
import crypto from "crypto";
import Razorpay from "razorpay";
import { validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils.js";

import { PLAN_DETAILS, t } from "../misc/constants.js";
import { Subscription } from "../models/subscription.model.js";
import { User } from "../models/user.model.js";
import { redisClient } from "../configs/redis.js";
import { invalidateUser } from "../utils/responseCache.js";
import { getBandwidthResetAt } from "../utils/bandwidthWindow.js";
import {
  getRazorpayInstance,
  retireOldSubscriptions,
} from "../controllers/subscriptionControllers.js";
import { sendInvoiceEmail, sendSubscriptionActionEmail } from "./emailService.js";
import { formatDate } from "../utils/formatDate.js";

export const razorpayWebhook = async (req, res, next) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const webhookSecret =
      process.env.NODE_ENV === "production"
        ? process.env.RAZORPAY_WEBHOOK_SECRET
        : process.env.TEST_RAZORPAY_WEBHOOK_SECRET;

    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    console.log({ expectedSignature, signature });

    const isValidSignature = validateWebhookSignature(
      rawBody,
      signature,
      webhookSecret,
    );
    req.body = JSON.parse(rawBody);
    if (!isValidSignature) {
      console.log(
        "Webhook signature validation failed",
        JSON.stringify(req.body, null, 2),
      );
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

    const isUpgrade = payload.notes?.isUpgrade === "true";
    const oldSubId = isUpgrade ? payload.notes.oldSubId : null;

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

        const userDoc = await User.findById(userId, { name: 1, email: 1 })
          .session(session)
          .lean();

        switch (event) {
          case "subscription.activated": {
            const isUpiFallback =
              payload.notes?.upiFallback === "true";

            if (isUpiFallback) {
              // UPI fallback downgrade — new lower-plan sub activated
              if (userDoc?.email) {
                sendSubscriptionActionEmail(
                  userDoc.name,
                  userDoc.email,
                  "downgrade",
                  "executed",
                  formatDate(payload.current_end),
                ).catch((err) =>
                  console.error("Downgrade email failed:", err),
                );
              }
            } else if (isUpgrade) {
              // Upgrade — new sub activated after upgrade checkout
              if (userDoc?.email) {
                sendSubscriptionActionEmail(
                  userDoc.name,
                  userDoc.email,
                  "upgrade",
                  "executed",
                  formatDate(payload.current_end),
                ).catch((err) =>
                  console.error("Upgrade email failed:", err),
                );
              }
            } else {
              // First-time subscription activated
              if (userDoc?.email) {
                sendSubscriptionActionEmail(
                  userDoc.name,
                  userDoc.email,
                  "activation",
                  "executed",
                  formatDate(payload.current_end),
                ).catch((err) =>
                  console.error("Activation email failed:", err),
                );
              }
            }
            break;
          }

          case "subscription.charged":
          case "subscription.resumed": {
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

              // Retire the previous subscription so background executors
              // (e.g. cancel-executor) never downgrade this active user.
              await retireOldSubscriptions(
                userId,
                updatedSub._id,
                session,
                oldSubId,
              );

              // Send email only on plan changes (not same-plan renewals)
              if (planChanged && existingPlan && userDoc?.email) {
                const oldPrice =
                  PLAN_DETAILS[existingPlan]?.priceInRupees || 0;
                const newPrice = planInfo.priceInRupees || 0;
                const isPlanUpgrade = newPrice > oldPrice;

                sendSubscriptionActionEmail(
                  userDoc.name,
                  userDoc.email,
                  isPlanUpgrade ? "upgrade" : "downgrade",
                  "executed",
                  formatDate(new Date(payload.current_end * 1000)),
                ).catch((err) =>
                  console.error("Plan change email failed:", err),
                );
              }
            }
            break;
          }

          case "subscription.cancelled":
          case "subscription.completed": {
            if (userDoc?.email) {
              sendSubscriptionActionEmail(
                userDoc.name,
                userDoc.email,
                "cancel",
                "executed",
                formatDate(
                  payload.ended_at
                    ? new Date(payload.ended_at * 1000)
                    : new Date(),
                ),
              ).catch((err) =>
                console.error("Cancel email failed:", err),
              );
            }
            break;
          }

          case "subscription.halted":
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

    if (isUpgrade && oldSubId) {
      try {
        const oldSub = await Promise.resolve(
          getRazorpayInstance().subscriptions.fetch(oldSubId),
        );
        if (oldSub.status !== "cancelled")
          await getRazorpayInstance().subscriptions.cancel(oldSubId, 0);
      } catch (cancelErr) {
        console.error(
          `Failed to cancel old sub ${oldSubId} on Razorpay:`,
          cancelErr,
        );
      }
    }

    await redisClient.del(`storageApp:user:${userId}:userdata`);
    await invalidateUser(userId);
    return res.status(200).end();
  } catch (err) {
    console.error("Webhook processing error:", err);
    return res.status(500).end();
  }
};
