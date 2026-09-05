# StorageApp — Node.js + Express Backend

![version](https://img.shields.io/badge/version-1.0.0-blue) ![node](https://img.shields.io/badge/node-%3E%3D20-green) ![license](https://img.shields.io/badge/license-ISC-lightgrey) ![mode](https://img.shields.io/badge/mode-saas%20%7C%20selfhosted-orange)

A production-ready, enterprise-grade backend for an open source cloud storage platform. Built with Node.js and Express (ES Modules), it powers file and directory management, resumable chunked uploads to any S3-compatible storage (AWS, Cloudflare R2, Backblaze B2, MinIO), role-based sharing, OAuth integrations, Google Drive import, and an optional live subscription billing system via Razorpay. Self-hosted mode (`APP_MODE=selfhosted`) runs the full storage stack without billing; SaaS mode (`APP_MODE=saas`) adds quotas, payments, and SaaS emails.

> **Example domains in this README are generic** — replace `https://example.com` / `https://api.example.com` / `support@example.com` with your own. First public release is `v1.0.0` (previously tracked internally as `v4.0.0`).

---

## Table of Contents

- [StorageApp — Node.js + Express Backend](#storageapp--nodejs--express-backend)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Tech Stack](#tech-stack)
  - [Architecture](#architecture)
  - [Project Structure](#project-structure)
  - [Environment Variables](#environment-variables)
    - [Core](#core)
    - [Database \& Cache](#database--cache)
    - [Storage (S3-compatible — AWS, R2, B2, MinIO)](#storage-s3-compatible--aws-r2-b2-minio)
    - [CDN](#cdn)
    - [OAuth](#oauth)
    - [Payments (Razorpay — SaaS only)](#payments-razorpay--saas-only)
    - [Email](#email)
    - [Misc](#misc)
  - [Quotas](#quotas)
  - [Running the Project](#running-the-project)
  - [API Overview](#api-overview)
  - [Authentication Flow](#authentication-flow)
  - [Upload Flow](#upload-flow)
  - [Subscription \& Billing](#subscription--billing)
  - [Google Drive Import](#google-drive-import)
  - [Background Jobs](#background-jobs)
  - [Caching](#caching)
  - [Bandwidth \& CDN](#bandwidth--cdn)
  - [Feedback](#feedback)
  - [Security](#security)
  - [Deployment](#deployment)
  - [Postman](#postman)

---

## Features

- **File & Directory Management** — create, rename, move, copy, star, trash, restore, and permanently delete files and directories with full recursive support.
- **Resumable Chunked Uploads** — client-driven S3/B2 multipart uploads via pre-signed PUT URLs. Files ≤ 5 MB use a single standard PUT; larger files use S3 multipart with plan-based chunk sizes and concurrency limits.
- **Thumbnail Support** — optional base64 `webp` thumbnail uploaded to the public bucket on upload completion (`≤1 MB`).
- **Bandwidth Tracking** — **SaaS:** previews and downloads are proxied through a Cloudflare Worker that reports bytes served via a signed HMAC webhook. **Self-hosted:** the server tracks bandwidth directly when generating download URLs (no worker needed).
- **Authentication**
  - Email + password with mandatory OTP verification (6-digit, 5-minute TTL, Redis).
  - Optional TOTP-based 2FA (authenticator app) — QR code, period 30s.
  - Forgot password with `resetToken` cookie handshake.
  - OAuth: Google and GitHub (PKCE `S256` + signed state cookies).
  - OAuth tokens encrypted at rest (AES-256-GCM).
  - Stateful sessions in Redis with signed `sessionId` cookies (7-day TTL, sliding window), per-plan device limits.
- **Role-Based Sharing**
  - Share files/directories with specific users by email (`view` / `edit`).
  - Public share links with optional expiry (`expiresIn` days).
  - Token regeneration and per-user revocation. Guest access via `/api/public/shared/:token`.
- **Google Drive Import** — server-side streaming from Drive directly to S3/B2 with real-time progress polling. Google Docs exported to Office formats; oversized exports saved as webview links.
- **Live Subscription Billing (Razorpay)** — **SaaS only** (`APP_MODE=saas`)
  - Plans: `FREE`, `PRO` (monthly/yearly), `BUSINESS` (monthly/yearly). Create, verify, upgrade (immediate), downgrade (`schedule_change_at: cycle_end`), and cancel.
  - Blocked if usage exceeds target quota. UPI fallback for scheduled downgrades.
  - Webhook handles `subscription.activated|charged|resumed|cancelled|completed|halted` + `invoice.paid`.
- **Feedback (SaaS only)** — tiered rate limit via Redis fixed 7-day window: `FREE 2/week → GitHub issues`, `PRO 5/week` and `BUSINESS 10/week` → `mailto:support@example.com`. Screenshot `≤1 MB` to public bucket, emails to user + admin.
- **Background Jobs (BullMQ)** — 9 scheduled jobs (separate scheduler/worker): downgrade/cancel executors, trash-collector, quota-reaper, abandoned-cart, share-token invalidation, bandwidth reset, halted reaper, active-users sweeper.
- **Admin Controls** — paginated users, role changes, forced logout, soft-delete (ban), recovery, permanent deletion with S3 cleanup, feedback moderation and direct email.
- **Notifications** — in-app `GET /api/notifications`, unread count, mark-all-read.
- **Security** — Helmet, CSRF double-submit + origin check, 4-tier Redis rate limiting, `httpOnly` signed cookies, HMAC webhooks, bcrypt cost 12.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES Modules, `type: module`) |
| Framework | Express 4 |
| Database | MongoDB via Mongoose 9 |
| Cache / Sessions | Redis v5 (JSON module) |
| Job Queue | BullMQ 5 (Queue + Worker + Scheduler) |
| Object Storage | Any S3-compatible API — AWS, R2, B2, MinIO (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`) |
| CDN | Cloudflare Worker (HMAC, SaaS) / CloudFront (signer) / Native S3 fallback |
| Payments | Razorpay 2.9 (SaaS) — `getRazorpayInstance()` lazy |
| Email | Resend 6.12 + Nodemailer 9.05 (`EMAIL_PROVIDER=resend\|smtp`) |
| OAuth | Google `googleapis` 170 + GitHub fetch, PKCE `S256` |
| Validation | Zod v4 |
| Security | Helmet 8, `express-rate-limit` + `rate-limit-redis`, bcrypt 6, AES-256-GCM |

---

## Architecture

```
Client (https://example.com)
  ├─→ CloudFront (S3 frontend)  or  NGINX → PM2 → Node (https://api.example.com)
  ├─→ Redis  (sessions, userdata cache 60s, responseCache 60s/900s, feedback 7d, rate-limit)
  ├─→ MongoDB (users, files, dirs, permissions, subscriptions)
  ├─→ S3 ×2  (STORAGE: private files, PUBLIC: thumbnails/avatars)
  ├─→ CDN Router (Cloudflare Worker HMAC → bandwidthWebhook | CloudFront signer | S3)
  └─→ BullMQ (scheduler ↔ worker) → 9 cron jobs → S3/Mongo/Notifications
Webhooks in: Razorpay HMAC (raw body) → subscription state → User.plan; Cloudflare HMAC → bandwidth increment
```

`app.js` sets `trust proxy 1`, `cors({origin: ALLOWED_ORIGINS, credentials:true})`, `cookieParser(COOKIE_SECRET)`, `helmet`, mounts `POST /api/subscriptions/webhook` and `POST /api/files/webhook` before `express.json`, then public `/api/auth|/oauth|/public/shared`, then `verifyCsrfOrigin` + `validateSession`, then authenticated `/api/uploads` (uploadLimiter), `/api/subscriptions` (SaaS), `/api/import`, `/api/user`, `/api/notifications`, `/api/files`, `/api/directories`, `/api/admin` (role guard). Graceful `SIGTERM/SIGINT` closes Redis and BullMQ.

---

## Project Structure

```
backend/
├── app.js                        # Entry — middleware bootstrap, route mounting, graceful shutdown
├── configs/
│   ├── connect.js                # Mongoose connection
│   └── redis.js                  # Redis client (JSON module)
├── controllers/
│   ├── authControllers.js        # register, login, OTP, forgot-password
│   ├── twoFactorAuthControllers.js # 2FA generate/enable/disable + TOTP verify
│   ├── commonGetControllers.js   # getItemInfo, getShareInfo, bin/starred/shared/recents/search
│   ├── commonSetControllers.js   # rename, move, star, trash, restore, share, revoke, newToken
│   ├── DirectoryControllers.js   # directory CRUD + ZIP download
│   ├── FileControllers.js        # preview, download, copy, delete
│   ├── importControllers.js      # Google Drive import pipeline + picker-token
│   ├── oauthControllers.js       # Google, GitHub, Google Drive OAuth (PKCE)
│   ├── subscriptionControllers.js# Razorpay lifecycle (plans, create/verify/update/cancel)
│   ├── uploadControllers.js      # S3 multipart/standard session (initiate/complete/retry/cancel)
│   ├── userControllers.js        # profile, stats/usage (cached 60s), avatar, logout, empty-trash, feedback (SaaS tiered)
│   ├── adminControllers.js       # dashboard, users, role, logout, ban, recover, delete, feedback
│   ├── notificationControllers.js# list, mark-read, unread-count
│   └── batchControllers.js       # bulk-download ZIP
├── middlewares/
│   ├── validateSession.js        # session + share token + CSRF origin double-submit
│   ├── checkAccessControl.js     # ownership / Permission / token fast-pass
│   ├── loadParentDirectory.js    # resolves targetId → req.target/parent
│   ├── rateLimiter.js            # global / auth / upload / public tiers (Redis)
│   ├── requireSaasMode.js        # 404 if APP_MODE !== saas
│   ├── restrictOperations.js     # restrictRoot, checkAuthProviderStatus
│   └── errorHandler.js           # centralized formatter
├── models/                       # user, user_file, directory, permission, subscription, notification, feedback
├── routes/                       # authRoutes, oauthRoutes, fileRoutes, directoryRoutes, uploadRoutes, userRoutes, shareRoutes, importDriveRoutes, subscriptionRoutes (SaaS), notificationRoutes, adminRoutes
├── schemas/                      # authSchema, userSchema (Zod)
├── services/
│   ├── s3Client.js               # s3Client + s3PublicClient, presigned URLs, multipart, HeadObject
│   ├── cdnRouter.js              # Cloudflare Worker HMAC / CloudFront signer / S3 fallback
│   ├── cloudfront.js             # CloudFront signer helper
│   ├── bandwidthWebhook.js       # Cloudflare HMAC → User $inc bandwidth
│   ├── emailService.js           # Resend/SMTP wraps (OTP always, sharing/ban SaaS-until-patch-now selfhosted open)
│   ├── mailProvider.js           # Resend vs nodemailer transport
│   ├── razorpayWebhook.js        # HMAC rawBody → subscription state → emails
│   ├── notificationService.js    # createNotification / notifyMany
│   └── schemaValidator.js
├── utils/
│   ├── helper.js                 # getErrorObject, getUserPayload, getFileDoc, cookieOptions, getUserLimits, checkEnv
│   ├── responseCache.js          # cacheWrap 60s user / 900s global, invalidateUser
│   ├── encryption.js             # AES-256-GCM (OAUTH_TOKEN_ENCRYPTION_KEY)
│   ├── bandwidthWindow.js        # 30-day rolling window
│   ├── remove.js / restore.js / serve.js # recursive delete/restore, serveZipS3
│   ├── formatDate.js / emailTemplates.js
│   └── ...
├── misc/constants.js             # PLAN_DETAILS, INSTANCE_CONFIG, t, requiredEnvVars
├── jobs/queueJobs.js             # BullMQ Queue + Worker + Scheduler (9 jobs)
├── docs/                         # Per-route request/response Markdown (10 files)
├── .env.example / package.json / CHANGELOG.md
└── public/                       # gitignored generated assets
```

---

## Environment Variables

Copy `.env.example` to `.env`. `APP_MODE` gates SaaS vs selfhosted.

### Core

| Variable | Description | Example |
|---|---|---|
| `NODE_ENV` | `development` or `production` | `production` |
| `PORT` | Server port | `4000` |
| `APP_MODE` | `saas` enables billing; `selfhosted` disables | `saas` |
| `APP_NAME` | Used in email templates | `StorageApp` |
| `ALLOWED_ORIGINS` | CORS + CSRF origin allowlist (CSV) | `https://example.com,https://api.example.com` |
| `MUTATING_METHODS` | Methods subject to CSRF check | `POST,PATCH,PUT,DELETE` |
| `COOKIE_SECRET` | Sign all cookies | `random 32+ hex` |
| `CLIENT_URL` | Frontend base URL | `https://example.com` |
| `CLIENT_APP_URL` | Frontend base URL for email links | `https://example.com` |
| `CLIENT_AUTH_CALLBACK_URL` | OAuth final redirect | `https://example.com/auth/callback` |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | AES-256-GCM key (32+ chars) | `hex` |

### Database & Cache

| Variable | Description | Example |
|---|---|---|
| `MONGO_URI` | MongoDB URI | `mongodb://user:pass@host:27017/db?replicaSet=rs0` |
| `REDIS_URL` | Redis connection (app cache, sessions, BullMQ jobs) | `redis://:pass@host:6379` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Legacy trio — only used when `REDIS_URL` is unset | `127.0.0.1` / `6379` |

### Storage (S3-compatible — AWS, R2, B2, MinIO)

| Variable | Description | Example |
|---|---|---|
| `STORAGE_BUCKET_NAME` | Private files bucket | `my-private-bucket` |
| `STORAGE_REGION` | Region or `auto` for R2 | `us-east-1` |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` | Creds | `...` |
| `STORAGE_ENDPOINT` | Custom endpoint (R2/B2/MinIO) — omit for AWS | `https://s3.us-east-005.backblazeb2.com` |
| `STORAGE_FORCE_PATH_STYLE` | `true` for MinIO | `false` |
| `PUBLIC_BUCKET_NAME` etc | Same 5 vars for public bucket (thumbnails/avatars/feedback) |  |
| `PUBLIC_BUCKET_CDN` | CDN that serves public bucket | `https://cdn.example.com` |
| `B2_BUCKET_NAME` | Alias = `STORAGE_BUCKET_NAME` for ZIP streaming — set same |  |

### CDN

| Variable | Description |
|---|---|
| `CDN_PROVIDER` | `cloudflare` (HMAC worker, **SaaS only**) / `cloudfront` / omit for S3 pre-signed |
| `CDN_DOMAIN` | Worker URL or CloudFront `dxxx.cloudfront.net` |
| `CLOUDFLARE_WEBHOOK_SECRET` | HMAC secret for bandwidth webhook — SaaS required if `cloudflare` |
| `CLOUDFRONT_PRIVATE_KEY` / `CLOUDFRONT_PUBLIC_KEY_ID` | For CloudFront signer (`\n` as `\\n`) |

### OAuth

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google login |
| `GOOGLE_DRIVE_REDIRECT_URI` | Drive import (`drive.readonly`, `prompt consent`) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_REDIRECT_URI` | GitHub login |

### Payments (Razorpay — SaaS only)

| Variable | Description |
|---|---|
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Live — used when `NODE_ENV=production` |
| `TEST_RAZORPAY_KEY_ID` / `TEST_RAZORPAY_KEY_SECRET` / `TEST_RAZORPAY_WEBHOOK_SECRET` | Test — used when `NODE_ENV !== production` |
| `SUBSCRIPTION_PLAN_PRO_MONTHLY` | Razorpay plan ID |
| `SUBSCRIPTION_PLAN_PRO_YEARLY` | Razorpay plan ID |
| `SUBSCRIPTION_PLAN_BUSINESS_MONTHLY` | Razorpay plan ID |
| `SUBSCRIPTION_PLAN_BUSINESS_YEARLY` | Razorpay plan ID |
| `RAZORPAY_OFFER_*` | e.g. `RAZORPAY_OFFER_UPGRADE` — single offer for prorated upgrade credit |

### Email

| Variable | Description |
|---|---|
| `EMAIL_PROVIDER` | `resend` (HTTP) or `smtp` |
| `RESEND_API_KEY` | Required if `resend` |
| `FROM_EMAIL` | Sender — e.g. `StorageApp <support@example.com>` |
| `ADMIN_EMAIL` | Feedback/admin alerts inbox — e.g. `support@example.com` |
| `SUPPORT_EMAIL` | Shown in templates as contact — e.g. `support@example.com` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | Required if `smtp` (`true` for 465) |

> **Email by mode** — OTP and password-reset are sent in **all** modes. Share/ban/recover/bulk, feedback alerts, invoice, abandoned-cart, subscription changes are SaaS-only except `sendSharingNotificationEmail` and `sendBulkShareEmails` and ban/recover now also work selfhosted if `FROM_EMAIL` is set. Access revocation uses a dedicated `accessRevokedEmailTemplate` via `sendBulkRevokedEmails`.

### Misc

| Variable | Description |
|---|---|
| `MAX_DEPTH` | Max recursion for ZIP `serveZipS3` (default `5`) |

`misc/constants.js:requiredEnvVars` (19 core) + `requiredSaaSVars` (4 plans) are checked on boot via `utils/helper.js checkEnv()` — missing throws.

---

## Quotas

Per `misc/constants.js:PLAN_DETAILS` (`INSTANCE_CONFIG` for selfhosted fallback):

| Limit | FREE | PRO | BUSINESS | Selfhosted (`APP_MODE=selfhosted`) |
|---|---|---|---|---|
| Storage quota | 2 GB | 100 GB | 500 GB | `user.maxQuota ?? Infinity` (admin-set) |
| Max file size | 100 MB | 2 GB | 10 GB | 50 GB (`INSTANCE_CONFIG`) |
| Monthly bandwidth | 5 GB | 200 GB | 1 TB | `Infinity` |
| Upload concurrency | 1 | 4 | 4 | 4 |
| Max devices | 1 | 3 | 5 | `Infinity` |
| Trash retention | 5 days | 15 days | 30 days | 5 days |
| Grace period | 7 days | 14 days | 30 days | 7 days |
| Public links | ❌ | ✅ | ✅ | ✅ (forced true) |

Admin `PATCH /api/admin/user/:id/quota` capped at 500 GB / 1 TB only in SaaS (`adminControllers.js:364`).

---

## Running the Project

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# edit .env — see tables above, use https://example.com for CLIENT_URL etc

# 3. Start (requires MongoDB + Redis)
npm run dev              # hot reload via --watch
npm start                # production

# 4. Background jobs (production — run scheduler once + N workers)
npm run worker:scheduler # registers 9 repeatables
npm run worker           # consumes — scale horizontally

# 5. Health
curl http://localhost:4000/api/user/info # 401 without session, 404 billing if selfhosted
```

Server listens on `PORT` (default `4000`). `trust proxy 1` expects reverse proxy. Generate Postman collection via `node generate_postman.js` and import `postman_collection.json`.

---

## API Overview

All authenticated routes need `sessionId` signed cookie.

| Prefix | Description | Auth | Rate Limiter |
|---|---|---|---|
| `POST /api/auth/*` | Register, login, OTP, forgot-password, 2FA | Public | `auth` 20/15m |
| `GET /api/oauth/*` | Google, GitHub, Google Drive (PKCE) | Mixed | `auth` 20/15m |
| `POST /api/subscriptions/webhook` | Razorpay events (HMAC raw body) | HMAC | `global` 1000/15m |
| `POST /api/files/webhook` | Cloudflare bandwidth (SaaS) | HMAC+SaaS | `global` |
| `GET /api/public/shared/:token` | Public preview/download/info | Token | `public` 200/15m |
| `/api/files/*` | File CRUD, share, copy, trash/restore | Session | `global` |
| `/api/directories/*` | Directory CRUD, share, ZIP download | Session | `global` |
| `/api/uploads/*` | Initiate/complete/retry/cancel (uploadLimiter) | Session | `upload` 100/15m |
| `/api/user/*` | Profile, stats/usage (cached 60s), search/bin/recents/starred/shared, feedback (SaaS), avatar, logout, sessions | Session | `global` |
| `/api/subscriptions/*` | Plans, current-plan (cached 900s/30s), history, create/verify/update/cancel | Session + `requireSaasMode` | `global` |
| `/api/import/*` | Drive `picker-token`, `initiate`, `start-import` 202, `progress`, `complete` | Session | `global` |
| `/api/notifications/*` | List, unread-count, mark-read | Session | `global` |
| `/api/admin/*` | Users, dashboard, ban/recover/delete, feedback | Session + `SUPER_ROLES` | `global` |

Full request/response for each endpoint is in [`docs/`](./docs/).

---

## Authentication Flow

2-step cookie handshake (stateful sessions in Redis):

```
1. POST /api/auth/login (or /register) → validates credentials
   → sets authToken cookie (5 min, httpOnly, signed) + { isTwoFactorEnabled }

2a. If 2FA disabled:
   POST /api/auth/request-otp → reads authToken, sends 6-digit OTP (5 min Redis)
   POST /api/auth/verify-otp → verifies OTP, checks maxDevices, creates
      storageApp:user:{id}:userdata (60s) + storageApp:user:{id}:session:{token} (7d, sliding to 6d if <1d)
      → sets sessionId (lax, signed) + csrf (double-submit, httpOnly false) → user payload

2b. If 2FA enabled: POST /api/auth/verify-totp → same session creation after TOTP

2c. OAuth: GET /api/oauth/<provider>/connect → 302 via PKCE state+verifier (5 min signed cookie)
   → GET /api/oauth/<provider>/callback → verifies state, getToken/verifyIdToken, links authProviders,
      creates session or returns twoFactor/sessionLimit redirect to CLIENT_AUTH_CALLBACK_URL
```

`validateSession.js` sliding TTL, `zAdd storageApp:active_users` (60s window), `restrictOperations`.

---

## Upload Flow

S3 never proxies through Node — pre-signed PUTs:

```
1. POST /api/uploads/initiate { file:{name,size,mime}, targetId }
   → quota vs getUserLimits, maxFileSize, key files/{userId}/{now}.{ext}
   → ≤5 MB: 1 PutObject URL (standard) | >5 MB: CreateMultipartUpload → N UploadPart URLs (chunkSize = min(size, limits.chunkSize))

2. Client PUTs each chunk → collects ETag

3. PUT /api/uploads/complete/:id { parts:[{partNumber,ETag}], thumbnailBase64? }
   → CompleteMultipartUpload (multipart only), HeadObject size verify, thumbnail ≤1 MB → PutObject thumbnails/{userId}/{name}.webp (CacheControl 2hr, public bucket)
   → UserFile.create + Directory.bulkWrite $inc size on path + del userdata + invalidateUser
```

`retryUpload` re-issues URLs, `cancelUpload` aborts multipart + `del` Redis.

---

## Subscription & Billing

SaaS only (`APP_MODE=saas`, `requireSaasMode` → 404 selfhosted). Plans `FREE`, `PRO_MONTHLY/YEARLY`, `BUSINESS_MONTHLY/YEARLY` (yearly discount computed). Each plan snapshot stores `quotaBytes, maxFileSize, chunkSize, monthlyBandwidth, maxUploadConcurrency, maxDevices, trashRetentionDays, gracePeriod, canCreatePublicLinks`.

* **Create:** `POST /api/subscriptions/create {plan}` → checks `active` status, dedup `created` <15m, Redis lock `lock:createSub:{id}` 30s → `razorpay.subscriptions.create total_count 120, notes {userId,plan}` → Subscription `created`.
* **Verify:** `POST /api/subscriptions/verify {razorpay_payment_id, subscription_id, signature}` → `validatePaymentVerification` + `fetch`, cancels `oldSubId` if `isUpgrade`, transaction `status active, currentPeriodStart/End`, `retireOldSubscriptions` sets others `upgraded`, updates `User plan/maxQuota/maxBandwidthQuota/subscription`.
* **Update (upgrade immediate vs downgrade scheduled):** `PATCH /api/subscriptions/update {plan}` → if quota `> newQuota` blocked, upgrade = new subscription with `isUpgrade oldSubId`, downgrade = `subscriptions.update schedule_change_at cycle_end`. UPI fallback catches `payment mode is upi` → fallback subscription.
* **Cancel:** `PATCH /api/subscriptions/cancel` → `subscriptions.cancel 0` → `cancelAtPeriodEnd true, endedAt`.
* **Webhook:** `POST /api/subscriptions/webhook` `validateWebhookSignature` on `rawBody` → `activated` (activation email), `charged/resumed` (updates User plan from `PLAN_DETAILS` of `planKey`, retires old), `cancelled/completed/halted`, `invoice.paid` (stores `invoiceUrl` + email). Lazy `getRazorpayInstance()` via `RAZORPAY_*` vs `TEST_RAZORPAY_*`.

---

## Google Drive Import

`GET /api/oauth/google-drive/connect` scope `drive.readonly prompt consent` → refresh_token.

```
1. GET  /api/import/google/picker-token → decrypt refreshToken, refresh if expiry-60s, bust userdata, return accessToken
2. POST /api/import/google/initiate { file:{id,name,mimeType,sizeBytes}, targetId } → Redis storageApp:user:{id}:import:{uploadId} 6hr
3. PUT  /api/import/google/start-import/:id → 202 fire-and-forget: googleapis drive.files.get/export (EXPORT_MAP for Docs → Office), stream via @aws-sdk/lib-storage Upload to S3, progress throttle 1s → bytesRead, thumbnailLink → public bucket, notify, status can_complete
4. GET  /api/import/google/progress/:id → poll
5. PUT  /api/import/google/complete/:id → verify size, create UserFile, notify
```
Oversize Google Docs exports → saved as `webviewLink` size 0.

---

## Background Jobs

BullMQ `Queue("StorageApp-Cron-Queue")` uses the Redis connection resolved by `parseRedisUrl()` (`REDIS_URL`, or the legacy `REDIS_HOST/PORT/PASSWORD` trio as fallback). `node jobs/queueJobs.js scheduler` registers; `node jobs/queueJobs.js worker` consumes (scale workers horizontally).

| Job | Schedule | What It Does |
|---|---|---|
| `downgrade-executor` | `0 0 * * *` daily 00:00 | Applies `downgrade_requested` where `currentPeriodEnd ≤ now` → User plan + limits + grace, sub `active` |
| `cancel-executor` | `0 0 * * *` daily 00:00 | `cancelation_requested` where `endedAt ≤ now` → FREE, sub `cancelled` |
| `trash-collector` | `0 1 * * *` daily 01:00 | `isDeleted && permanentDeleteAt ≤ now` → S3 dedup (count key), `Directory/UserFile` bulkWrite, notify |
| `quota-reaper` | `0 2 * * *` daily 02:00 | `gracePeriodEndsAt ≤ now` + over quota → delete oldest files until quota met |
| `bandwidth-reset` | `0 0 * * *` daily 00:00 | `bandwidthResetAt ≤ now` (or null) → `used 0, reset +30d`, bust cache, notify |
| `share-token-invalidator` | `0 0 * * *` daily 00:00 | `shareTokenExpiresAt < now` → `$unset` shareToken/publicRole |
| `halted-subscription-reaper` | `0 4 * * *` daily 04:00 | `status halted` older than `gracePeriod` (FREE 7d etc) → FREE |
| `abandoned-cart-tracker` | `*/15 * * * *` every 15m | `status created` + 30m ago → email `CLIENT_APP_URL/pricing?resume=plan` |
| `active-users-sweeper` | `0 3 * * *` daily 03:00 | `ZREMRANGEBYSCORE storageApp:active_users 0 (now-30d)` |

`JOB_OPTS removeOnComplete 7d/100`, `recalculateTrashExpiry` helper.

---

## Caching

`utils/responseCache.js` fail-open, namespaces `storageApp:cache:`.

* **Tier1 per-user (60s except plan 30s):** `info`, `usage`, `stats` (self only, admin `?id` bypass), `plan` (`current-plan`). Busted via `invalidateUser(userId)` in all mutating paths: `updateName/avatar`, upload complete, file/dir delete, `create/verify/update/cancel` subscription, admin quota, `razorpayWebhook`, `bandwidthWebhook`, `queueJobs`.
* **Tier2 global (900s):** `plans` (`getPlanOptions` static).
* `getUserPayload` still caches `storageApp:user:{id}:userdata` 60s via `validateSession.js`.

---

## Bandwidth & CDN

`services/cdnRouter.js` 3-way:

* **SaaS + `CDN_PROVIDER=cloudflare`:** `s3SignedUrl` 300s wrapped in JSON `{u,url}` HMAC `CLOUDFLARE_WEBHOOK_SECRET` → `${CDN_DOMAIN}/stream|download?token=base64(payload|hmac)` → Worker validates and calls `POST /api/files/webhook` (`x-cf-webhook-auth`) → `services/bandwidthWebhook.js` `User $inc usedBandwidthQuota` via `ensureBandwidthWindow` (30d rolling, lazy).
* **CloudFront:** `cloudfront.js` signer 5 min with `ResponseContentDisposition`.
* **Native:** S3 pre-signed 300s fallback. Selfhosted never uses worker route — `FileControllers.js:25` `isCloudflare = IS_SAAS_MODE && CDN_PROVIDER===cloudflare` fallback tracks inline.

---

## Feedback

`POST /api/user/feedback` **SaaS only** (`requireSaasMode`). Zod `feedbackSchema`, tiered Redis fixed 7-day window `storageApp:feedback:{userId}:count`:

* `FREE 2/week → 429` message directs to `https://github.com/Subham0813/Storage-App-Backend/issues`
* `PRO 5/week`, `BUSINESS 10/week → 429` directs to `mailto:support@example.com`

Screenshot `≤1 MB` → `feedback/{userId}/{now}.webp` in public bucket, `Feedback.create`, `processFeedbackEmails` sends user confirmation + admin alert to `ADMIN_EMAIL`. Admin `GET /feedback/:userId`, `PATCH /feedback/:feedbackId`, `POST /feedback/:feedbackId/reply` also email reply.

Frontend `TopBar.jsx` shows `Send Feedback` (mail) only if `isSaaS`, otherwise `Report Issue on GitHub`.

---

## Security

* **Cookies** `httpOnly` signed, `secure` in production, `sameSite lax`, `csrf` double-submit (`x-csrf-token` vs `csrf` cookie) + `verifyCsrfOrigin` vs `ALLOWED_ORIGINS` for `MUTATING_METHODS`.
* **Rate limiting** Redis 4 tiers: `global 1000/15m`, `auth 20/15m`, `upload 100/15m`, `public-link 200/15m` — keyed by `userId` or `ipKeyGenerator`.
* **Helmet** `frame-ancestors none`, `CSP default-src` disabled per design, `HSTS` etc.
* **HMAC** Razorpay rawBody + Cloudflare payload|sig `timingSafeEqual`.
* **Passwords** bcrypt 12.
* **Token encryption** AES-256-GCM with `OAUTH_TOKEN_ENCRYPTION_KEY` derived sha256, format `iv:cipher:tag`.
* **OAuth** PKCE `S256` for all providers, signed state 5 min.
* **Share tokens** `base64URLEncode(crypto.randomBytes 32)` with expiry.

---

## Deployment

`trust proxy 1` for `X-Forwarded-*`. Graceful `SIGTERM/SIGINT` closes `redisClient` + BullMQ `worker.close()` + `mongoose.disconnect()`.

```bash
# Production on EC2 (example.com)
NODE_ENV=production PORT=4000 node --env-file=.env app.js
# or PM2
pm2 start ecosystem.config.js --env production --update-env
pm2 save && pm2 startup
# nginx server_name api.example.com → proxy_pass http://127.0.0.1:4000; + certbot --nginx -d example.com -d api.example.com
```

Run separate units for jobs: `node --env-file=.env jobs/queueJobs.js scheduler` once, `node --env-file=.env jobs/queueJobs.js worker` × N. `checkEnv()` in `utils/helper.js` fails fast if `requiredEnvVars` / `requiredSaaSVars` missing.

Scaling: add workers horizontally (BullMQ), cache static `plans`, use `isSaaS` to avoid Razorpay instantiation selfhosted.

---

## Postman

Import `postman_collection.json` (generated via `node generate_postman.js`). Set `{{base_url}} = https://api.example.com`, `{{sessionId}}` from `verify-otp` cookie. Auth cookie flow documented in `docs/`.

Full request/response docs per route group in [`docs/`](./docs/) + Cloudflare Worker sample in `docs/self-host-documentation/sample_worker.js`.

---

*Changelog: [`CHANGELOG.md`](./CHANGELOG.md) — initial release `v1.0.0`.* <!-- was v4.0.0 internally -->
