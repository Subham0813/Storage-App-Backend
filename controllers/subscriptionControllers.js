import mongoose from "mongoose";
import crypto from "crypto";
import Razorpay from "razorpay";
import {
  validatePaymentVerification,
  validateWebhookSignature,
} from "razorpay/dist/utils/razorpay-utils.js";

import {
  basePlans,
  PLAN_DETAILS,
  PLAN_FEATURE_LISTS,
  PLAN_TAGLINES,
  t,
} from "../misc/constants.js";
import { Subscription } from "../models/subscription.model.js";
import { User } from "../models/user.model.js";
import { getErrorObject } from "../utils/helper.js";
import { redisClient } from "../configs/redis.js";
import { cacheWrap, cacheNs, invalidateUser } from "../utils/responseCache.js";
import { getBandwidthResetAt } from "../utils/bandwidthWindow.js";
import { createReadStream } from "fs";
import { safeDate } from "../utils/formatDate.js";

let _razorpayInstance = null;

// Lazily constructed so self-hosted deployments (which never use billing)
// don't require Razorpay keys at startup. Only created when first used,
// which is exclusively on SaaS-mode code paths.
export const getRazorpayInstance = () => {
  if (!_razorpayInstance) {
    _razorpayInstance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpayInstance;
};

export const getPlanOptions = async (req, res, next) => {
  try {
    const plans = await cacheWrap(cacheNs.global("plans"), 900, async () =>
      basePlans.map((plan) => {
        const monthly = PLAN_DETAILS[`${plan}_MONTHLY`] || PLAN_DETAILS.FREE;
        const yearly = PLAN_DETAILS[`${plan}_YEARLY`] || PLAN_DETAILS.FREE;

        const monthlyCostIfBilledMonthly = monthly.priceInRupees * 12;
        const actualYearlyCost = yearly.priceInRupees;
        const discountPercent =
          monthlyCostIfBilledMonthly > 0
            ? Math.round(
                ((monthlyCostIfBilledMonthly - actualYearlyCost) /
                  monthlyCostIfBilledMonthly) *
                  100,
              )
            : 0;

        return {
          name: plan,
          baseKey: plan,
          quota: monthly.quotaBytes / 1e9,
          maxFileSize: monthly.maxFileSize / 1e9,
          priceMo: monthly.priceInRupees,
          priceYr: yearly.priceInRupees,
          discountTag: discountPercent > 0 ? `Save ${discountPercent}%` : null,
          isPopular: plan === "PRO",
          tagline: PLAN_TAGLINES[plan] || null,
          limits: {
            storage: monthly.quotaBytes / 1e9,
            bandwidth: monthly.monthlyBandwidthLimit / 1e9,
            maxFileSize: monthly.maxFileSize / 1e9,
            uploadConcurrency: monthly.maxUploadConcurrency,
            maxDevices: monthly.maxDevices,
            trashRetentionDays: monthly.trashRetentionDays,
            gracePeriodDays: monthly.gracePeriod || 7,
            canCreatePublicLinks: monthly.canCreatePublicLinks,
          },
          features: PLAN_FEATURE_LISTS[plan] || [
            "Private cloud storage",
            "Fast file uploads & downloads",
            "Google Drive cloud import",
          ],
        };
      }),
    );

    return res.status(200).json({ success: true, data: { plans } });
  } catch (err) {
    next(err);
  }
};

export const getCurrentPlan = async (req, res, next) => {
  try {
    const uid = req.user._id.toString();
    const layout = await cacheWrap(cacheNs.user("plan", uid), 30, async () => {
      const user = await User.findById(req.user._id)
        .populate("root")
        .populate("subscription")
        .lean();

      const sub = user?.subscription;
      const usedQuota = user?.root?.size || 0;
      const { planId, billingCycle, priceInRupees, ...limits } =
        PLAN_DETAILS[user?.plan || "FREE"];

      return {
        plan: {
          name: user?.plan || "FREE",
          billingCycle: billingCycle || null,
          priceInRupees,
          status: sub?.status || "",
          maxQuota: user?.maxQuota || PLAN_DETAILS.FREE.quotaBytes,
          usedQuota,
          startedAt: safeDate(sub?.currentPeriodStart),
          renewAt: safeDate(sub?.currentPeriodEnd),
          expireAt: user?.subscriptionExpiresAt || null,
          endedAt: safeDate(sub?.endedAt),
          cancelAtPeriodEnd: sub?.cancelAtPeriodEnd || false,
          limits: sub?.limits || limits,
          invoiceUrl: sub?.invoiceUrl || "",
        },
      };
    });

    return res.status(200).json({ success: true, data: layout });
  } catch (err) {
    next(err);
  }
};

export const getSubscriptionHistory = async (req, res, next) => {
  try {
    const lim = parseInt(req.query?.limit);
    const limit = lim > 0 && lim <= 100 ? lim : 50;

    const cursor = req.query?.cursor;
    if (cursor && !mongoose.isValidObjectId(cursor))
      return next(getErrorObject("Invalid cursor."));

    const query = { user: req.user._id };
    if (cursor) query._id = { $gt: cursor };

    const subs = await Subscription.find(query)
      .sort({ createdAt: -1 })
      .select(
        "-_id planKey price billingCycle status currentPeriodStart currentPeriodEnd endedAt createdAt invoiceUrl",
      )
      .limit(limit)
      .lean();

    const nextCursor = subs.length < limit ? null : subs[subs.length - 1]._id;

    const history = subs.map((sub) => ({
      name: sub.planKey,
      price: sub.price,
      billingCycle: sub.billingCycle,
      status: sub.status,
      startedAt: safeDate(sub.currentPeriodStart),
      renewAt: safeDate(sub.currentPeriodEnd),
      endedAt: safeDate(sub.endedAt),
      subscribedAt: sub.createdAt,
      invoiceUrl: sub.invoiceUrl,
    }));

    return res
      .status(200)
      .json({ success: true, data: { history, nextCursor } });
  } catch (err) {
    next(err);
  }
};

/**
 * Mark every other subscription of a user as terminal so background executors
 * (e.g. cancel-executor) never downgrade a user who just activated a new plan.
 */
export const retireOldSubscriptions = async (userId, keepSubId, session, oldSubId = null) => {
  if (oldSubId) {
    await Subscription.findOneAndUpdate(
      {
        razorpaySubscriptionId: oldSubId,
        user: userId,
        _id: { $ne: keepSubId },
      },
      { $set: { status: "upgraded", cancelAtPeriodEnd: false } },
      { session },
    );
  } else {
    await Subscription.findOneAndUpdate(
      {
        user: userId,
        _id: { $ne: keepSubId },
        status: { $in: ["active", "cancelation_requested"] },
      },
      { $set: { status: "upgraded", cancelAtPeriodEnd: false } },
      { session, sort: { createdAt: -1 } },
    );
  }
};

export const createSubscription = async (req, res, next) => {
  try {
    const { plan } = req.body;
    const selectedPlan = PLAN_DETAILS[plan.toUpperCase()];
    const user = req.user;

    if (!plan || !selectedPlan) {
      return next(getErrorObject("Invalid plan selected.", 400));
    }

    if (user.subscription && user.subscription.status === "active") {
      return res.status(400).json({
        success: false,
        message:
          "You already have an active subscription. Please use the 'Change Plan' option to upgrade or downgrade.",
      });
    }

    const { planId, quotaBytes, billingCycle } = selectedPlan;
    if (user.root.size > quotaBytes) {
      return next(
        getErrorObject(
          "Cannot downgrade to a plan with lower quota than your current usage.",
          400,
        ),
      );
    }

    const pendingSub = await Subscription.findOne({
      user: user._id,
      planKey: plan.toUpperCase(),
      status: { $in: ["created", "abandoned"] },
    })
      .select("razorpaySubscriptionId")
      .lean();

    if (pendingSub) {
      return res.status(200).json({
        success: true,
        data: { subscriptionId: pendingSub.razorpaySubscriptionId },
      });
    }

    // Check if user is a first-time subscriber (no prior subscription records)
    const priorSubCount = await Subscription.countDocuments({ user: user._id });
    const isFirstTimeSub = priorSubCount === 0;

    // Redis lock to prevent race condition (duplicate subscriptions)
    const lockKey = `storageApp:lock:createSub:${user._id}`;
    const lockAcquired = await redisClient.set(lockKey, "1", {
      NX: true,
      EX: 30,
    });
    if (!lockAcquired) {
      return next(
        getErrorObject(
          "A subscription is already being processed. Please wait a moment and try again.",
          429,
        ),
      );
    }

    try {
      const options = {
        plan_id: planId,
        total_count: 120,
        notes: { userId: user._id.toString(), plan: plan.toUpperCase() },
      };

      const razorpaySub =
        await getRazorpayInstance().subscriptions.create(options);

      // console.log({razorpaySub});

      await Subscription.create({
        user: user._id,
        razorpaySubscriptionId: razorpaySub.id,
        planId,
        planKey: plan.toUpperCase(),
        billingCycle,
        status: "created",
        price: selectedPlan.priceInRupees,
        limits: {
          quotaBytes: selectedPlan.quotaBytes,
          maxFileSize: selectedPlan.maxFileSize,
          chunkSize: selectedPlan.chunkSize,
          monthlyBandwidthLimit: selectedPlan.monthlyBandwidthLimit,
          maxUploadConcurrency: selectedPlan.maxUploadConcurrency,
          maxDevices: selectedPlan.maxDevices,
          canCreatePublicLinks: selectedPlan.canCreatePublicLinks,
          trashRetentionDays: selectedPlan.trashRetentionDays,
          gracePeriod: selectedPlan.gracePeriod,
        },
      });

      await redisClient.del(`storageApp:user:${user._id}:userdata`);
      await invalidateUser(user._id);

      return res.status(201).json({
        success: true,
        data: {
          subscriptionId: razorpaySub.id,
          isFirstTimeSub,
        },
      });
    } finally {
      await redisClient.del(lockKey);
    }
  } catch (err) {
    console.log(err);
    next(err);
  }
};

export const verifySubscriptionSignature = async (req, res, next) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
    } = req.body;

    if (
      !razorpay_payment_id ||
      !razorpay_subscription_id ||
      !razorpay_signature ||
      !razorpay_order_id
    ) {
      return next(getErrorObject("Missing required payment credentials.", 400));
    }

    const isVerified = validatePaymentVerification(
      {
        order_id: razorpay_order_id,
        payment_id: razorpay_payment_id,
      },
      razorpay_signature,
      process.env.RAZORPAY_KEY_SECRET,
    );

    if (!isVerified) {
      return next(
        getErrorObject(
          "Cryptographic signature mismatch. Payment rejected.",
          403,
        ),
      );
    }

    const subDetails = await getRazorpayInstance().subscriptions.fetch(
      razorpay_subscription_id,
    );

    // console.log({ subDetails });

    const actualPlan = subDetails.notes.plan;

    if (!actualPlan || !PLAN_DETAILS[actualPlan]) {
      return next(
        getErrorObject("Invalid plan associated with this order.", 400),
      );
    }

    const { quotaBytes, monthlyBandwidthLimit } = PLAN_DETAILS[actualPlan];

    // Cancel old subscription FIRST to prevent double billing
    const isUpgrade =
      subDetails.notes.isUpgrade === "true" && subDetails.notes.oldSubId;
    if (isUpgrade) {
      try {
        await getRazorpayInstance().subscriptions.cancel(
          subDetails.notes.oldSubId,
          false,
        );
      } catch (_) {
        /* old sub may already be cancelled */
      }
    }

    const userdataKey = `storageApp:user:${req.user._id}:userdata`;
    // Invalidate before the transaction so no concurrent request can serve
    // the pre-change user while the payment is being activated.
    await redisClient.del(userdataKey);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        let updatedSub = await Subscription.findOneAndUpdate(
          { razorpaySubscriptionId: subDetails.id },
          {
            status: "active",
            currentPeriodStart: subDetails.current_start
              ? safeDate(subDetails.current_start)
              : undefined,
            currentPeriodEnd: subDetails.current_end
              ? safeDate(subDetails.current_end)
              : undefined,
          },
          { session, returnDocument: "after" },
        )
          .select("_id")
          .lean();

        if (!updatedSub) {
          const planInfo = PLAN_DETAILS[actualPlan];
          const [newSub] = await Subscription.create(
            [
              {
                user: req.user._id,
                razorpaySubscriptionId: subDetails.id,
                planId: subDetails.plan_id,
                planKey: actualPlan,
                status: "active",
                price: planInfo.priceInRupees,
                currentPeriodStart: subDetails.current_start
                  ? safeDate(subDetails.current_start)
                  : undefined,
                currentPeriodEnd: subDetails.current_end
                  ? safeDate(subDetails.current_end)
                  : undefined,
                limits: {
                  quotaBytes: planInfo.quotaBytes,
                  maxFileSize: planInfo.maxFileSize,
                  chunkSize: planInfo.chunkSize,
                  monthlyBandwidthLimit: planInfo.monthlyBandwidthLimit,
                  maxUploadConcurrency: planInfo.maxUploadConcurrency,
                  maxDevices: planInfo.maxDevices,
                  canCreatePublicLinks: planInfo.canCreatePublicLinks,
                  trashRetentionDays: planInfo.trashRetentionDays,
                  gracePeriod: planInfo.gracePeriod,
                },
              },
            ],
            { session },
          );
          updatedSub = newSub.toObject();
        }

        // Retire the previous subscription so background executors
        // (e.g. cancel-executor) never downgrade this freshly-activated user.
        await retireOldSubscriptions(
          req.user._id,
          updatedSub._id,
          session,
          isUpgrade ? subDetails.notes.oldSubId : null,
        );

        await User.findByIdAndUpdate(
          req.user._id,
          {
            plan: actualPlan,
            maxQuota: quotaBytes,
            maxBandwidthQuota: monthlyBandwidthLimit,
            subscription: updatedSub._id,
            // Plan actually changed → start a fresh 30-day bandwidth window.
            ...(req.user.plan !== actualPlan && {
              usedBandwidthQuota: 0,
              bandwidthResetAt: getBandwidthResetAt(),
            }),
          },
          { session },
        );
      });
    } finally {
      session.endSession();
    }

    // Invalidate AFTER the commit so the next read refetches the new plan.
    await redisClient.del(userdataKey);
    await invalidateUser(req.user._id);

    return res
      .status(200)
      .json({ success: true, message: "Subscription verified." });
  } catch (err) {
    next(err);
  }
};

export const updateSubscriptionPlan = async (req, res, next) => {
  try {
    const newPlanKey = req.body.plan?.toUpperCase();
    const user = req.user;

    if (!newPlanKey || !PLAN_DETAILS[newPlanKey]) {
      return next(getErrorObject("Invalid plan selected.", 400));
    }
    if (!user || !user.subscription) {
      return next( getErrorObject("No active subscription found to modify.", 400));
    }

    const currentPlanKey = user.subscription?.planKey;
    if (currentPlanKey === newPlanKey) {
      return next(getErrorObject("You are already on this plan.", 400));
    }

    const currentQuota = PLAN_DETAILS[currentPlanKey].quotaBytes;
    const newPlanDetails = PLAN_DETAILS[newPlanKey];
    const newQuota = newPlanDetails.quotaBytes;
    const isDowngrade = newQuota < currentQuota;

    const usedSpace = user.root?.size || 0;
    if (isDowngrade && usedSpace > newQuota) {
      const excessGB = ((usedSpace - newQuota) / 1e9).toFixed(2);
      const message = `Downgrade blocked. You are using more storage than the ${newPlanKey.split("_")[0]} plan allows. Please delete at least ${excessGB} GB of files before downgrading.`;
      return next(getErrorObject(message, 400));
    }

    const subId = user.subscription.razorpaySubscriptionId;
    const newPlanId = newPlanDetails.planId;

    if (!isDowngrade) {
      // Reuse an actively-pending upgrade sub (created/abandoned), Razorpay subIds never expire
      const pendingUpgrade = await Subscription.findOne({
        user: user._id,
        planKey: newPlanKey,
        status: { $in: ["created", "abandoned"] },
      }).select("razorpaySubscriptionId").lean();

      if (pendingUpgrade) {
        return res.status(200).json({
          success: true,
          data: { subscriptionId: pendingUpgrade.razorpaySubscriptionId },
        });
      }

      // Redis lock — prevents two concurrent update clicks from creating duplicate subs
      const lockKey = `storageApp:lock:updateSub:${user._id}`;
      const lockAcquired = await redisClient.set(lockKey, "1", { NX: true, EX: 30 });
      if (!lockAcquired) {
        return next(getErrorObject("A plan change is already being processed. Please try again.", 429));
      }

      try {
        // Dedup fallback — purge any STALE pending sub, then create fresh
        const stalePending = await Subscription.findOne({
          user: user._id,
          status: "created",
          planKey: newPlanKey,
        });

        if (stalePending) {
          try {
            await getRazorpayInstance().subscriptions.cancel(
              stalePending.razorpaySubscriptionId,
              false,
            );
          } catch (_) {
            /* already cancelled or invalid */
          }
          await Subscription.deleteOne({ _id: stalePending._id });
        }

        const upgradeOptions = {
          plan_id: newPlanId,
          total_count: 120,
          notes: {
            userId: user._id.toString(),
            plan: newPlanKey,
            isUpgrade: "true",
            oldSubId: subId,
          },
        };

        const upgradeSub =
          await getRazorpayInstance().subscriptions.create(upgradeOptions);

        await Subscription.create({
          user: user._id,
          razorpaySubscriptionId: upgradeSub.id,
          planId: newPlanId,
          planKey: newPlanKey,
          status: "created",
          price: newPlanDetails.priceInRupees,
          limits: {
            quotaBytes: newPlanDetails.quotaBytes,
            maxFileSize: newPlanDetails.maxFileSize,
            chunkSize: newPlanDetails.chunkSize,
            monthlyBandwidthLimit: newPlanDetails.monthlyBandwidthLimit,
            maxUploadConcurrency: newPlanDetails.maxUploadConcurrency,
            maxDevices: newPlanDetails.maxDevices,
            canCreatePublicLinks: newPlanDetails.canCreatePublicLinks,
            trashRetentionDays: newPlanDetails.trashRetentionDays,
            gracePeriod: newPlanDetails.gracePeriod,
          },
        });

        await redisClient.del(`storageApp:user:${user._id}:userdata`);
        await invalidateUser(user._id);

        return res.status(200).json({
          success: true,
          data: {
            subscriptionId: upgradeSub.id,
            requiresUpiFallback: true,
          },
        });
      } finally {
        await redisClient.del(lockKey);
      }
    } else {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await getRazorpayInstance().subscriptions.update(subId, {
            plan_id: newPlanId,
            schedule_change_at: "cycle_end",
            customer_notify: 1,
          });

          await Subscription.findByIdAndUpdate(
            user.subscription._id,
            {
              planId: newPlanId,
              planKey: newPlanKey,
              status: "downgrade_requested",
              price: newPlanDetails.priceInRupees,
              limits: {
                quotaBytes: newPlanDetails.quotaBytes,
                maxFileSize: newPlanDetails.maxFileSize,
                chunkSize: newPlanDetails.chunkSize,
                monthlyBandwidthLimit: newPlanDetails.monthlyBandwidthLimit,
                maxUploadConcurrency: newPlanDetails.maxUploadConcurrency,
                maxDevices: newPlanDetails.maxDevices,
                canCreatePublicLinks: newPlanDetails.canCreatePublicLinks,
                trashRetentionDays: newPlanDetails.trashRetentionDays,
                gracePeriod: newPlanDetails.gracePeriod,
              },
            },
            { session },
          );
        });

        await redisClient.del(`storageApp:user:${user._id}:userdata`);

        return res.status(200).json({
          success: true,
          message: "Downgrade scheduled for the end of your billing cycle.",
        });
      } catch (rzpErr) {
        if (rzpErr.error?.description?.includes("payment mode is upi")) {
          // UPI mandates cannot be updated mid-cycle → fall back to
          // cancel-current + subscribe-to-new with the prorated switch credit.
          try {
            // Dedup: clean up any abandoned pending sub
            const pendingSub = await Subscription.findOne({
              user: user._id,
              status: "created",
            });
            if (pendingSub) {
              try {
                await getRazorpayInstance().subscriptions.cancel(
                  pendingSub.razorpaySubscriptionId,
                  false,
                );
              } catch (_) {
                /* already cancelled or invalid */
              }
              await Subscription.deleteOne({ _id: pendingSub._id });
            }

            // Cancel the current mandate immediately so the customer is not
            // charged twice (they re-pay for the new plan via checkout).
            if (
              user.subscription?.status !== "cancelation_requested" ||
              user.subscription?.status !== "cancelled"
            ) {
              const cancelledSub =
                await getRazorpayInstance().subscriptions.cancel(subId, 0);

              // Mark the current sub for cancellation at period end
              await Subscription.findByIdAndUpdate(user.subscription._id, {
                cancelAtPeriodEnd: false,
                endedAt: safeDate(cancelledSub?.end_at),
                status: "cancelled",
              });
            }

            // Create the new lower-plan subscription with switch credit
            const fallbackOptions = {
              plan_id: newPlanId,
              total_count: 120,
              notes: {
                userId: user._id.toString(),
                plan: newPlanKey,
                isUpgrade: "false",
                oldSubId: subId,
                upiFallback: "true",
              },
            };

            const fallbackSub =
              await getRazorpayInstance().subscriptions.create(fallbackOptions);

            await Subscription.create({
              user: user._id,
              razorpaySubscriptionId: fallbackSub.id,
              planId: newPlanId,
              planKey: newPlanKey,
              status: "created",
              price: newPlanDetails.priceInRupees,
              limits: {
                quotaBytes: newPlanDetails.quotaBytes,
                maxFileSize: newPlanDetails.maxFileSize,
                chunkSize: newPlanDetails.chunkSize,
                monthlyBandwidthLimit: newPlanDetails.monthlyBandwidthLimit,
                maxUploadConcurrency: newPlanDetails.maxUploadConcurrency,
                maxDevices: newPlanDetails.maxDevices,
                canCreatePublicLinks: newPlanDetails.canCreatePublicLinks,
                trashRetentionDays: newPlanDetails.trashRetentionDays,
                gracePeriod: newPlanDetails.gracePeriod,
              },
            });

            await redisClient.del(`storageApp:user:${user._id}:userdata`);
            await invalidateUser(user._id);

            return res.status(200).json({
              success: true,
              data: {
                subscriptionId: fallbackSub.id,
                requiresUpiFallback: true,
              },
            });
          } catch (fallbackErr) {
            console.error("UPI downgrade fallback failed:", fallbackErr);
            return next(
              getErrorObject(
                "UPI mandates cannot be scheduled for downgrades. Please enjoy your current plan and subscribe to the lower plan when it expires.",
                400,
              ),
            );
          }
        }
        throw rzpErr;
      } finally {
        session.endSession();
      }
    }
  } catch (err) {
    // console.log(err);
    next(err);
  }
};

export const cancelSubscriptionPlan = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || !user.subscription || user.subscription.status !== "active") {
      return next(getErrorObject("No active subscription found.", 400));
    }

    const subId = user.subscription.razorpaySubscriptionId;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const cancelledSub = await getRazorpayInstance().subscriptions.cancel(
          subId,
          0,
        );

        await Subscription.findByIdAndUpdate(
          user.subscription._id,
          {
            cancelAtPeriodEnd: true,
            endedAt: safeDate(cancelledSub?.end_at),
            status: "cancelation_requested",
          },
          { session },
        );
      });
    } finally {
      session.endSession();
    }

    await redisClient.del(`storageApp:user:${user._id}:userdata`);
    await invalidateUser(user._id);

    return res.status(200).json({
      success: true,
      message:
        "Subscription cancelled successfully. You will keep your storage limits until the end of your billing cycle.",
    });
  } catch (err) {
    return next(
      getErrorObject(
        "Failed to cancel subscription. Please contact support.",
        500,
      ),
    );
  }
};
