import crypto from "crypto";
import { INSTANCE_CONFIG, PLAN_DETAILS, t } from "../misc/constants.js";
import { Permission } from "../models/permission.model.js";
import { redisClient } from "../configs/redis.js";

/**
 * Attach permissionsCount to an array of items (Directories or Files)
 */
export const attachPermissionsCount = async (items) => {
  if (!items || items.length === 0) return items;

  const itemIds = items.map((item) => item._id);
  const counts = await Permission.aggregate([
    { $match: { itemId: { $in: itemIds } } },
    { $group: { _id: "$itemId", count: { $sum: 1 } } },
  ]);

  const countMap = {};
  counts.forEach((c) => {
    countMap[c._id.toString()] = c.count;
  });

  items.forEach((item) => {
    item.permissionsCount = countMap[item._id.toString()] || 0;
  });

  return items;
};

/**
 * Error formatting utility
 */
export const getErrorObject = (
  errMessage = "Server error. Request not fulfilled.",
  statusCode = 400,
) => {
  const err = new Error("");
  err.customMessage = errMessage;
  err.statusCode = statusCode;
  return err;
};

export const safeCompare = (a, b) => {
  const aStr = String(a ?? "");
  const bStr = String(b ?? "");
  const aBuf = Buffer.from(aStr);
  const bBuf = Buffer.from(bStr);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

/**
 * Strip sensitive data from User
 */
export const getUserPayload = async (user) => {
  if (!user) return null;
  const userDoc = user._doc || user;
  const {
    _id,
    avatarKey,
    password,
    googleId,
    githubId,
    updatedAt,
    __v,
    root,
    integrations,
    subscription,
    ...safeUser
  } = userDoc;

  safeUser.isDeleted = !!userDoc.isDeleted;

  if (integrations) {
    safeUser.integrations = Object.keys(integrations || {}).join("&") || "";
  }

  if (subscription) {
    const [plan, billingCycle] = subscription?.planKey?.split("_");
    safeUser.subscription = {
      plan: plan.toLowerCase(),
      billingCycle: billingCycle.toLowerCase(),
      status: subscription.status,
      subscriptionStartedAt: subscription.currentPeriodStart,
      subscriptionRenewAt: subscription.currentPeriodEnd,
      subscriptionEndsAt: subscription.endedAt,
      subscriptionExpiresAt: safeUser.subscriptionExpiresAt,
    };
    delete safeUser.subscriptionExpiresAt;
  } else safeUser.subscription = {};

  if (root) {
    safeUser.rootId = root._id.toString();
    safeUser.usedQuota = root.size;
  }

  if (avatarKey)
    safeUser.avatarUrl = `${process.env.PUBLIC_BUCKET_CDN}/${avatarKey}`;
  safeUser.authProviders = safeUser?.authProviders?.join("&");
  safeUser.id = _id.toString();

  const { planId, billingCycle, priceInRupees, ...limits } =
    PLAN_DETAILS[user.plan || "FREE"];
  safeUser.limits = limits;

  try {
    const [active, logged] = await Promise.all([
      redisClient.exists(`storageApp:user:${_id.toString()}:userdata`),
      redisClient.sCard(`storageApp:user:${_id.toString()}:session_index`),
    ]);
    safeUser.isActive = active === 1;
    safeUser.isLogged = logged > 0;
  } catch {
    // Redis unavailable: default to inactive/offline (sessions live in Redis too).
  }

  return safeUser;
};

/**
 * Strip sensitive data from File
 */
export const getFileDoc = (file) => {
  if (!file) return null;
  const fileDoc = file._doc || file;
  const {
    _id,
    key,
    thumbnailKey,
    webviewLink,
    shareToken,
    shareTokenExpiresAt,
    shareLink,
    __v,
    deletedBy,
    userId,
    path,
    ...safeFile
  } = fileDoc;

  if (!safeFile.parentId) safeFile.name = "Home";

  safeFile.owner =
    userId && typeof userId === "object" && userId?._id
      ? { id: userId._id.toString(), name: userId.name }
      : { id: userId ? userId.toString() : "" };

  if (Array.isArray(path) && path.length > 0) {
    safeFile.path = path
      .filter((p) => p && p._id)
      .map((p) => ({ id: p._id.toString(), name: p.name }));
    safeFile.path[0].name = "Home";
  } else {
    safeFile.path = [];
  }

  safeFile.thumbnailUrl = thumbnailKey
    ? `${process.env.PUBLIC_BUCKET_CDN}/${file.thumbnailKey}`
    : null;

  safeFile.shareTokenExpiresAt = shareTokenExpiresAt || null;

  safeFile.id = _id.toString();
  return safeFile;
};

/**
 * set cookie options based on environment and age
 */
export const cookieOptions = ({
  maxAge = 5 * t._min * 1000,
  sameSite = "lax",
}) => ({
  httpOnly: true,
  signed: true,
  secure: process.env.NODE_ENV === "production",
  sameSite,
  maxAge,
  path: "/",
});

/**
 * Set the double-submit CSRF cookie.
 * Not httpOnly (frontend must read it) and not signed (so `req.cookies.csrf`
 * is the plain value and `document.cookie` matches it exactly). The cookie is
 * the CSRF token itself; the browser echoes it back as the `X-CSRF-Token`
 * header, and the backend compares the two (double-submit pattern).
 */
export const setCsrfCookie = (res, maxAge = 7 * t._day * 1000) => {
  const token = crypto.randomBytes(32).toString("base64url");
  res.cookie("csrf", token, {
    httpOnly: false,
    signed: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path: "/",
  });
  return token;
};

export const getUserLimits = (user) => {
  const mode = process.env.APP_MODE || "selfhosted";

  if (mode === "saas") {
    // SaaS Mode: Rely on Razorpay subscriptions and predefined plans
    const planKey = user.subscription?.planKey || user.plan;
    const planDetail = PLAN_DETAILS[planKey] || PLAN_DETAILS["FREE"];

    return {
      maxStorage:
        user.subscription?.limits?.quotaBytes || planDetail.quotaBytes,
      maxFileSize:
        user.subscription?.limits?.maxFileSize || planDetail.maxFileSize,
      monthlyBandwidth:
        user.subscription?.limits?.monthlyBandwidthLimit ||
        planDetail.monthlyBandwidthLimit,
      chunkSize: planDetail.chunkSize || 5e6,
      maxUploadConcurrency: planDetail.maxUploadConcurrency || 4,
      trashRetentionDays: planDetail.trashRetentionDays || 5,
      canCreatePublicLinks: planDetail.canCreatePublicLinks ?? false,
      maxDevices: planDetail.maxDevices || 1,
    };
  }

  // Self-Hosted Mode: Rely on Admin-controlled database fields and global configs
  return {
    maxStorage: user.maxQuota ?? Infinity,
    monthlyBandwidth: user.maxBandwidthQuota ?? Infinity,
    maxFileSize: INSTANCE_CONFIG.maxFileSize || 50e9,
    chunkSize: INSTANCE_CONFIG.chunkSize || 5e6,
    maxUploadConcurrency: INSTANCE_CONFIG.maxUploadConcurrency || 4,
    trashRetentionDays: PLAN_DETAILS.FREE.trashRetentionDays,
    canCreatePublicLinks: true,
    maxDevices: Infinity,
  };
};
