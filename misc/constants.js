export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
export const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI;
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export const GOOGLE_DRIVE_REDIRECT_URI = process.env.GOOGLE_DRIVE_REDIRECT_URI;

export const FILENAME_REGEX = /^[^\\/:\*\?"<>|]+$/;
export const EMAIL_REGEX = /^[\w.%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}$/;
export const SUPER_ROLES = ["admin", "super_admin"];

export const IS_SAAS_MODE = process.env.APP_MODE === "saas";
export const EMAIL_PROVIDER = process.env.EMAIL_PROVIDER || "resend";

export const t = {
  _ms: 1000,
  _min: 60,
  _hr: 3600,
  _day: 86400,
};

export const EXPORT_MAP = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.presentation":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const PLAN_DETAILS = {
  FREE: {
    planId: null,
    billingCycle: null,
    priceInRupees: 0,
    quotaBytes: 2 * 1e9, // 2GB
    maxFileSize: 100 * 1e6, // 100MB
    chunkSize: 5e6,
    monthlyBandwidthLimit: 5 * 1e9, // 5GB
    maxUploadConcurrency: 2,
    maxDevices: 1,
    canCreatePublicLinks: false,
    trashRetentionDays: 5,
    gracePeriod: 7,
  },

  // PRO — 100 GB Tier
  PRO_MONTHLY: {
    planId: process.env.SUBSCRIPTION_PLAN_PRO_MONTHLY,
    billingCycle: "monthly",
    priceInRupees: 99,
    quotaBytes: 100 * 1e9, // 100GB
    maxFileSize: 2 * 1e9, // 2GB
    chunkSize: 8e6,
    monthlyBandwidthLimit: 200 * 1e9, // 200GB
    maxUploadConcurrency: 4,
    maxDevices: 3,
    canCreatePublicLinks: true,
    trashRetentionDays: 15,
    gracePeriod: 14,
  },
  PRO_YEARLY: {
    planId: process.env.SUBSCRIPTION_PLAN_PRO_YEARLY,
    billingCycle: "yearly",
    priceInRupees: 999,
    quotaBytes: 100 * 1e9, // 100GB
    maxFileSize: 2 * 1e9, // 2GB
    chunkSize: 8e6,
    monthlyBandwidthLimit: 200 * 1e9, // 200GB
    maxUploadConcurrency: 4,
    maxDevices: 3,
    canCreatePublicLinks: true,
    trashRetentionDays: 15,
    gracePeriod: 14,
  },

  // BUSINESS — 500 GB Tier
  BUSINESS_MONTHLY: {
    planId: process.env.SUBSCRIPTION_PLAN_BUSINESS_MONTHLY,
    billingCycle: "monthly",
    priceInRupees: 299,
    quotaBytes: 500 * 1e9, // 500GB
    maxFileSize: 10 * 1e9, // 10GB
    chunkSize: 10e6,
    monthlyBandwidthLimit: 1000 * 1e9, // 1000GB
    maxUploadConcurrency: 8,
    maxDevices: 5,
    canCreatePublicLinks: true,
    trashRetentionDays: 30,
    gracePeriod: 30,
  },
  BUSINESS_YEARLY: {
    planId: process.env.SUBSCRIPTION_PLAN_BUSINESS_YEARLY,
    billingCycle: "yearly",
    priceInRupees: 2999,
    quotaBytes: 500 * 1e9, // 500GB
    maxFileSize: 10 * 1e9, // 10GB
    chunkSize: 10e6,
    monthlyBandwidthLimit: 1000 * 1e9, // 1000GB
    maxUploadConcurrency: 8,
    maxDevices: 5,
    canCreatePublicLinks: true,
    trashRetentionDays: 30,
    gracePeriod: 30,
  },
};

// Core variables the server must have to boot safely (all modes).
// These are validated at startup in app.js — the process exits with a clear
// message if any are missing from the environment.
export const requiredEnvVars = [
  // Runtime & server
  "NODE_ENV",
  "PORT",
  "APP_MODE",
  "COOKIE_SECRET",
  "MONGO_URI",
  "REDIS_URL",

  // CORS / CSRF
  "ALLOWED_ORIGINS",
  "MUTATING_METHODS",

  // Object storage (BYO S3-compatible) — file + public buckets
  "STORAGE_ACCESS_KEY",
  "STORAGE_SECRET_KEY",
  "STORAGE_BUCKET_NAME",
  "PUBLIC_ACCESS_KEY",
  "PUBLIC_SECRET_KEY",
  "PUBLIC_BUCKET_NAME",

  // Google OAuth (sign-in + Drive import)
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_DRIVE_REDIRECT_URI",

  // Frontend URLs
  "CLIENT_AUTH_CALLBACK_URL",
  "CLIENT_URL",
  "CLIENT_APP_URL",

  // Security
  "OAUTH_TOKEN_ENCRYPTION_KEY",

  // Email (RESEND_API_KEY or SMTP_* required depending on EMAIL_PROVIDER —
  // enforced conditionally in app.js via smtpEnvVars)
  "FROM_EMAIL",
  "APP_NAME",
];

// SMTP credentials required only when EMAIL_PROVIDER=smtp (checked in app.js).
// SMTP_PASS is optional — mailProvider.js falls back to SMTP_PASSWORD.
export const smtpEnvVars = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER"];

// Billing variables required only in SaaS mode (APP_MODE=saas).
export const requiredSaaSVars = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "RAZORPAY_OFFER_FIRST_SUB_25_OFF",
  "RAZORPAY_OFFER_UPGRADE_10_OFF",
  "SUBSCRIPTION_PLAN_PRO_MONTHLY",
  "SUBSCRIPTION_PLAN_PRO_YEARLY",
  "SUBSCRIPTION_PLAN_BUSINESS_MONTHLY",
  "SUBSCRIPTION_PLAN_BUSINESS_YEARLY",
];

export const INSTANCE_CONFIG = {
  maxFileSize: 50 * 1000 * 1000 * 1000, // 50GB max single file upload
  chunkSize: 5e6, // 5MB S3 multipart chunks
  maxUploadConcurrency: 4, // Number of parallel chunks
};

export const THUMBNAIL_SIZE = 1e6; //1MB

export const fmtSize = (bytes) => {
  const gb = bytes / 1e9;
  if (gb >= 1000) return `${gb / 1000} TB`;
  if (gb >= 1) return `${gb} GB`;
  return `${Math.round(gb * 1000)} MB`;
};

export const PLAN_TAGLINES = {
  FREE: "Perfect for light, personal storage",
  PRO: "Serious space for everyday use.",
  BUSINESS: "Maximum capacity for teams & studios.",
};
export const PLAN_FEATURE_LISTS = {
  FREE: [
    "Private personal vault storage",
    "2x Parallel upload concurrency",
    "Single device active access",
    "Direct Google Drive cloud import",
    "5-day automatic trash recovery",
    "7-day post-expiry data grace period",
  ],
  PRO: [
    "Public link sharing with custom expiry",
    "4x High-speed concurrent uploads",
    "Multi-device sync across 3 devices",
    "Google Drive cloud migration",
    "15-day trash auto-recovery window",
    "14-day post-expiry data grace period",
  ],
  BUSINESS: [
    "Full public link sharing & team tools",
    "8x Ultra-fast parallel upload engine",
    "Multi-device sync across 5 devices",
    "Google Drive bulk cloud migration",
    "30-day extended trash retention",
    "30-day post-expiry data grace period",
  ],
};

export const basePlans = ["FREE", "PRO", "BUSINESS"];
