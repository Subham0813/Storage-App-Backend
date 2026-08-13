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
    quotaBytes: 5 * 1e9,
    maxFileSize: 100 * 1e6, // 100MB
    chunkSize: 5 * 1024 * 1024,
    monthlyBandwidthLimit: 10 * 1e9, // 10GB
    maxUploadConcurrency: 2,
    maxDevices: 1,
    canCreatePublicLinks: false,
    trashRetentionDays: 5,
    gracePeriod: 7,
  },

  // 50 GB Tier
  PRO_MONTHLY: {
    planId: process.env.SUBSCRIPTION_PLAN_PRO_MONTHLY,
    billingCycle: "monthly",
    priceInRupees: 49,
    quotaBytes: 50 * 1e9,
    maxFileSize: 2 * 1e9, // 2GB
    chunkSize: 8 * 1024 * 1024,
    monthlyBandwidthLimit: 100 * 1e9,
    maxUploadConcurrency: 4,
    maxDevices: 3,
    canCreatePublicLinks: true,
    trashRetentionDays: 15,
    gracePeriod: 15,
  },
  PRO_YEARLY: {
    planId: process.env.SUBSCRIPTION_PLAN_PRO_YEARLY,
    billingCycle: "yearly",
    priceInRupees: 499,
    quotaBytes: 50 * 1e9,
    maxFileSize: 2 * 1e9,
    chunkSize: 8 * 1024 * 1024,
    monthlyBandwidthLimit: 150 * 1e9, // +50GB Yearly Kicker
    maxUploadConcurrency: 4,
    maxDevices: 3,
    canCreatePublicLinks: true,
    trashRetentionDays: 15,
    gracePeriod: 20,
  },

  // 200 GB Tier
  ULTRA_MONTHLY: {
    planId: process.env.SUBSCRIPTION_PLAN_ULTRA_MONTHLY,
    billingCycle: "monthly",
    priceInRupees: 149,
    quotaBytes: 200 * 1e9,
    maxFileSize: 10 * 1e9, // 10GB
    chunkSize: 10 * 1024 * 1024,
    monthlyBandwidthLimit: 500 * 1e9,
    maxUploadConcurrency: 6,
    maxDevices: 5,
    canCreatePublicLinks: true,
    trashRetentionDays: 30,
    gracePeriod: 30,
  },
  ULTRA_YEARLY: {
    planId: process.env.SUBSCRIPTION_PLAN_ULTRA_YEARLY,
    billingCycle: "yearly",
    priceInRupees: 1499,
    quotaBytes: 200 * 1e9,
    maxFileSize: 10 * 1e9,
    chunkSize: 10 * 1024 * 1024,
    monthlyBandwidthLimit: 700 * 1e9, // +200GB Yearly Kicker
    maxUploadConcurrency: 6,
    maxDevices: 5,
    canCreatePublicLinks: true,
    trashRetentionDays: 30,
    gracePeriod: 40,
  },

  // 500 GB Tier
  PREMIUM_MONTHLY: {
    planId: process.env.SUBSCRIPTION_PLAN_PREMIUM_MONTHLY,
    billingCycle: "monthly",
    priceInRupees: 399,
    quotaBytes: 500 * 1e9,
    maxFileSize: 25 * 1e9, // 25GB
    chunkSize: 12 * 1024 * 1024,
    monthlyBandwidthLimit: 1000 * 1e9,
    maxUploadConcurrency: 8,
    maxDevices: 7,
    canCreatePublicLinks: true,
    trashRetentionDays: 45,
    gracePeriod: 45,
  },
  PREMIUM_YEARLY: {
    planId: process.env.SUBSCRIPTION_PLAN_PREMIUM_YEARLY,
    billingCycle: "yearly",
    priceInRupees: 3999,
    quotaBytes: 500 * 1e9,
    maxFileSize: 25 * 1e9,
    chunkSize: 12 * 1024 * 1024,
    monthlyBandwidthLimit: 1300 * 1e9, // +300GB Yearly Kicker
    maxUploadConcurrency: 8,
    maxDevices: 7,
    canCreatePublicLinks: true,
    trashRetentionDays: 45,
    gracePeriod: 55,
  },

  // 1000 GB Tier
  ELITE_MONTHLY: {
    planId: process.env.SUBSCRIPTION_PLAN_ELITE_MONTHLY,
    billingCycle: "monthly",
    priceInRupees: 699,
    quotaBytes: 1000 * 1e9,
    maxFileSize: 50 * 1e9, // 50GB
    chunkSize: 15 * 1024 * 1024,
    monthlyBandwidthLimit: 2000 * 1e9,
    maxUploadConcurrency: 10,
    maxDevices: 10,
    canCreatePublicLinks: true,
    trashRetentionDays: 60,
    gracePeriod: 60,
  },
  ELITE_YEARLY: {
    planId: process.env.SUBSCRIPTION_PLAN_ELITE_YEARLY,
    billingCycle: "yearly",
    priceInRupees: 6999,
    quotaBytes: 1000 * 1e9,
    maxFileSize: 50 * 1e9,
    chunkSize: 15 * 1024 * 1024,
    monthlyBandwidthLimit: 2500 * 1e9, // +500GB Yearly Kicker
    maxUploadConcurrency: 10,
    maxDevices: 10,
    canCreatePublicLinks: true,
    trashRetentionDays: 60,
    gracePeriod: 75,
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
  "B2_BUCKET_NAME",

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
export const smtpEnvVars = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
];

// Billing variables required only in SaaS mode (APP_MODE=saas).
export const requiredSaaSVars = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "RAZORPAY_OFFER_FIRST_SUB_25_OFF",
  "RAZORPAY_OFFER_200_OFF",
  "RAZORPAY_OFFER_150_OFF",
  "RAZORPAY_OFFER_100_OFF",
  "RAZORPAY_OFFER_75_OFF",
  "RAZORPAY_OFFER_50_OFF",
  "RAZORPAY_OFFER_25_OFF",
  "SUBSCRIPTION_PLAN_PRO_MONTHLY",
  "SUBSCRIPTION_PLAN_PRO_YEARLY",
  "SUBSCRIPTION_PLAN_ULTRA_MONTHLY",
  "SUBSCRIPTION_PLAN_ULTRA_YEARLY",
  "SUBSCRIPTION_PLAN_PREMIUM_MONTHLY",
  "SUBSCRIPTION_PLAN_PREMIUM_YEARLY",
  "SUBSCRIPTION_PLAN_ELITE_MONTHLY",
  "SUBSCRIPTION_PLAN_ELITE_YEARLY",
];

export const INSTANCE_CONFIG = {
  maxFileSize: 50 * 1000 * 1000 * 1000, // 50GB max single file upload
  chunkSize: 5 * 1024 * 1024, // 5MB S3 multipart chunks
  maxUploadConcurrency: 4, // Number of parallel chunks
};

export const THUMBNAIL_SIZE = 1 * 1024 * 1024; //2MB
