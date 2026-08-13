# StorageApp — Node.js + Express Backend

A production-ready, enterprise-grade backend for an Open Source cloud storage platform. Built with Node.js and Express (ES6 Modules), it powers file and directory management, resumable chunked uploads to any S3-compatible storage (AWS, Cloudflare R2, Backblaze B2, MinIO), role-based sharing, OAuth integrations, Google Drive import, and an optional live subscription billing system via Razorpay.

---

## Table of Contents

- [StorageApp — Node.js + Express Backend](#storageapp--nodejs--express-backend)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Tech Stack](#tech-stack)
  - [Project Structure](#project-structure)
  - [Environment Variables](#environment-variables)
    - [Core](#core)
    - [Database \& Cache](#database--cache)
    - [Storage (S3-compatible — AWS, Backblaze B2, Cloudflare R2, MinIO)](#storage-s3-compatible--aws-backblaze-b2-cloudflare-r2-minio)
    - [OAuth](#oauth)
    - [Payments (Razorpay — SaaS mode only)](#payments-razorpay--saas-mode-only)
    - [Email (Resend)](#email-resend)
  - [Running the Project](#running-the-project)
  - [API Overview](#api-overview)
  - [Authentication Flow](#authentication-flow)
  - [Upload Flow](#upload-flow)
  - [Subscription \& Billing](#subscription--billing)
  - [Google Drive Import](#google-drive-import)
  - [Background Jobs](#background-jobs)
  - [Security](#security)

---

## Features

- **File & Directory Management** — create, rename, move, copy, star, trash, restore, and permanently delete files and directories with full recursive support.
- **Resumable Chunked Uploads** — client-driven S3/B2 multipart uploads via pre-signed PUT URLs. Files ≤ 5 MB use a single standard PUT; larger files use S3 multipart with plan-based chunk sizes and concurrency limits.
- **Thumbnail Support** — optional base64 webp thumbnail uploaded to S3 on upload completion.
- **Bandwidth Tracking** — SaaS: all file previews and downloads are proxied through a Cloudflare CDN worker that reports bytes served via a signed HMAC webhook. Self-hosted: the server tracks bandwidth directly when preview/download URLs are generated (no worker/webhook needed).
- **Authentication**
  - Email + password with mandatory OTP verification (6-digit, 5-minute TTL, stored in Redis).
  - Optional TOTP-based 2FA (authenticator app) — setup via QR code, verified at login before session creation.
  - Forgot password flow with `resetToken` cookie handshake.
  - OAuth: Google and GitHub (PKCE + signed state cookies).
  - OAuth tokens encrypted at rest in MongoDB (AES-256-GCM).
  - Stateful sessions stored in Redis with signed `sessionId` cookies (7-day TTL, sliding window).
  - Per-plan device limits enforced at session creation.
- **Role-Based Sharing**
  - Share files and directories with specific users by email (`view` / `edit` permissions).
  - Public share links with optional expiry (`expiresIn` days).
  - Share token regeneration and per-user access revocation.
  - Guest access via `/api/public/shared/:token` path.
- **Google Drive Import** — server-side streaming from Google Drive directly to S3/B2 with real-time progress polling. Google Docs are exported to Office formats; oversized exports are saved as webview links.
- **Live Subscription Billing (Razorpay)** — SaaS mode only (`APP_MODE=saas`)
  - Create, verify, upgrade, downgrade, and cancel subscriptions.
  - Prorated 50% upgrade credits applied as Razorpay offers.
  - Downgrade scheduling at `cycle_end`; blocked if usage exceeds target quota.
  - Webhook handler for `subscription.charged`, `subscription.halted`, `subscription.cancelled`, `subscription.resumed`, `subscription.completed`, `invoice.paid`.
- **Background Jobs (BullMQ)**
  - `downgrade-executor` — applies scheduled downgrades at cycle end (hourly).
  - `cancel-executor` — drops users to FREE whose cancelled subscription has expired (hourly).
  - `trash-collector` — permanently deletes expired trashed files from DB and S3 (daily at 2am).
  - `quota-reaper` — deletes oldest files for users over quota after grace period (daily at 3am).
  - `abandoned-cart-tracker` — sends re-engagement emails for incomplete checkouts (every 15 min).
  - `share-token-invalidator` — clears expired public share tokens from files and directories (hourly).
  - `bandwidth-reset` — resets monthly bandwidth usage to 0 for all users (1st of each month).
  - `halted-subscription-reaper` — downgrades users with halted subscriptions for 7+ days back to FREE (daily at 4am).
- **Resource Quotas** — storage quota, monthly bandwidth limit, max file size, max devices, and trash retention days enforced per plan.
- **Admin Controls** — paginated user listing, role changes, forced logout, soft-delete (ban), recovery, and permanent deletion with S3 cleanup.
- **Security** — Helmet headers, CSRF origin check, Redis-backed rate limiting (global, auth, upload, public-link tiers), httpOnly signed cookies.

---

## Tech Stack

| Layer            | Technology                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------- |
| Runtime          | Node.js (ES Modules)                                                                      |
| Framework        | Express 4                                                                                 |
| Database         | MongoDB via Mongoose                                                                      |
| Cache / Sessions | Redis (`redis` v5, JSON module)                                                           |
| Job Queue        | BullMQ                                                                                    |
| Object Storage   | Any S3-compatible API (AWS, R2, B2, MinIO) (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`) |
| CDN              | Cloudflare (signed tokens for stream/download)                                            |
| Payments         | Razorpay (SaaS mode)                                                                      |
| Email            | Resend                                                                                    |
| OAuth            | Google (`googleapis`), GitHub (fetch-based)                                               |
| Validation       | Zod v4                                                                                    |
| Security         | Helmet, `express-rate-limit` + `rate-limit-redis`, bcrypt, AES-256-GCM token encryption   |

---

## Project Structure

```
backend/
├── app.js                        # Entry point — middleware bootstrap, route mounting
├── configs/
│   ├── connect.js                # Mongoose connection
│   └── redis.js                  # Redis client setup
├── controllers/
│   ├── authControllers.js        # register, login, OTP, forgot-password
│   ├── twoFactorAuthControllers.js # 2FA setup (generate, enable) and TOTP login verification
│   ├── commonGetControllers.js   # getItemInfo, getShareInfo, bin/starred/shared-by-me/recents/search
│   ├── commonSetControllers.js   # rename, move, star, trash, restore, share, revoke, newToken
│   ├── DirectoryControllers.js   # directory-specific CRUD + ZIP download
│   ├── FileControllers.js        # preview, download, copy, delete
│   ├── importControllers.js      # Google Drive import pipeline
│   ├── oauthControllers.js       # Google, GitHub, Google Drive OAuth flows
│   ├── subscriptionControllers.js# Razorpay subscription lifecycle
│   ├── uploadControllers.js      # S3 multipart/standard upload session management
│   ├── userControllers.js        # profile, storage info, avatar, logout, empty-trash, delete account
│   └── adminControllers.js       # admin user management
├── middlewares/
│   ├── validateSession.js        # session auth + share token verification + CSRF origin check
│   ├── checkAccessControl.js     # ownership / permission / token access guard
│   ├── loadParentDirectory.js    # resolves targetId → req.target / req.parent
│   ├── quotaCheck.js             # storage quota enforcement
│   ├── rateLimiter.js            # global / auth / upload / public-link rate limiters
│   ├── restrictOperations.js     # restrictRoot, checkAuthProviderStatus
│   └── errorHandler.js           # centralised error response formatter
├── models/
│   ├── user.model.js
│   ├── user_file.model.js
│   ├── directory.model.js
│   ├── permission.model.js
│   └── subscription.model.js
├── routes/
│   ├── authRoutes.js
│   ├── oauthRoutes.js
│   ├── fileRoutes.js
│   ├── directoryRoutes.js
│   ├── uploadRoutes.js
│   ├── userRoutes.js
│   ├── shareRoutes.js            # public /api/public/shared/:token routes
│   ├── importDriveRoutes.js
│   ├── subscriptionRoutes.js     # /api/subscriptions/* (SaaS mode only)
│   ├── notificationRoutes.js     # /api/notifications/* (user alerts)
│   └── adminRoutes.js
├── schemas/
│   ├── authSchema.js             # Zod schemas for auth payloads
│   └── userSchema.js             # Zod schemas for file/upload/share payloads
├── services/
│   ├── s3Client.js               # S3 client, presigned URLs, multipart helpers
│   ├── cdnRouter.js              # Dynamic CDN URL signing (Cloudflare Worker, CloudFront, or S3 fallback)
│   ├── cloudfront.js             # AWS CloudFront signed URL helper
│   ├── bandwidthWebhook.js       # Cloudflare bandwidth webhook handler
│   ├── emailService.js           # Resend email templates (OTP, share notify, ban/recover, invoice)
│   ├── razorpayWebhook.js        # Razorpay webhook signature verification + event handling
│   └── schemaValidator.js        # Shared Zod validation middleware helper
├── utils/
│   ├── helper.js                 # getErrorObject, getUserPayload, getFileDoc, cookieOptions, getUserLimits
│   ├── encryption.js             # AES-256-GCM encrypt/decrypt for OAuth tokens at rest
│   ├── remove.js                 # recursiveDelete, recursiveRemove (soft)
│   ├── restore.js                # restoreDescendants
│   ├── serve.js                  # serveZipS3, sanitizeName
│   └── emailTemplates.js
├── misc/
│   └── constants.js              # PLAN_DETAILS, EXPORT_MAP, time constants, requiredEnvVars
├── jobs/
│   └── queueJobs.js              # BullMQ workers: all 9 scheduled jobs
├── docs/                         # Full API request/response reference (Markdown)
│   ├── self-host-documentation/  # Self-hosted deployment guides and samples
│   ├── authRouteRequestResponse.md
│   ├── oauthRouteRequestResponse.md
│   ├── fileRouteRequestResponse.md
│   ├── directoryRouteRequestResponse.md
│   ├── uploadRouteRequestResponse.md
│   ├── userRouteRequestResponse.md
│   ├── shareRouteRequestResponse.md
│   ├── importDriveRouteRequestResponse.md
│   ├── subscriptionRouteRequestResponse.md
│   └── adminRouteRequestResponse.md
├── .env.example
├── package.json
└── CHANGELOG.md
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values before starting.

### Core

| Variable                     | Description                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `NODE_ENV`                   | `development` or `production`                                                     |
| `PORT`                       | Server port (default `4000`)                                                      |
| `ALLOWED_ORIGINS`            | Comma-separated frontend URLs for CORS and CSRF origin check                      |
| `MUTATING_METHODS`           | Comma-separated HTTP methods subject to CSRF check (e.g. `POST,PATCH,PUT,DELETE`) |
| `COOKIE_SECRET`              | Secret used to sign all cookies                                                   |
| `CLIENT_URL`                 | Frontend base URL (used in OAuth redirects and checkout links)                    |
| `CLIENT_AUTH_CALLBACK_URL`   | Frontend URL that OAuth providers redirect to after login                          |
| `CLIENT_APP_URL`             | Frontend base URL used in email link targets                                       |
| `APP_NAME`                   | Application name used in email templates                                          |
| `APP_MODE`                   | `"saas"` to enable billing routes; omit or `"selfhosted"` to disable              |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | Secret for AES-256-GCM encryption of OAuth tokens stored in MongoDB               |

### Database & Cache

| Variable         | Description                          |
| ---------------- | ------------------------------------ |
| `MONGO_URI`      | MongoDB connection string            |
| `REDIS_URL`      | Redis connection URL                 |
| `REDIS_HOST`     | Redis host for BullMQ queue workers  |
| `REDIS_PORT`     | Redis port for BullMQ queue workers  |
| `REDIS_PASSWORD` | Optional Redis password for BullMQ   |

### Storage (S3-compatible — AWS, Backblaze B2, Cloudflare R2, MinIO)

| Variable                    | Description                                                     |
| --------------------------- | --------------------------------------------------------------- |
| `STORAGE_REGION`            | S3-compatible region (e.g. `us-east-1`, `auto` for R2)          |
| `STORAGE_ACCESS_KEY`        | Access key ID                                                   |
| `STORAGE_SECRET_KEY`        | Secret access key                                               |
| `STORAGE_BUCKET_NAME`       | Bucket name for private files                                   |
| `STORAGE_ENDPOINT`          | Custom endpoint URL (required for B2, R2, MinIO — omit for AWS) |
| `STORAGE_FORCE_PATH_STYLE`  | `"true"` for MinIO/path-style providers; omit for AWS/R2        |
| `PUBLIC_REGION`             | Region for the public bucket (avatars, thumbnails)              |
| `PUBLIC_ACCESS_KEY`         | Access key ID for the public bucket                             |
| `PUBLIC_SECRET_KEY`         | Secret access key for the public bucket                         |
| `PUBLIC_BUCKET_NAME`        | Bucket name for public assets (avatars, thumbnails)             |
| `PUBLIC_BUCKET_CDN`         | CDN base URL that serves the public bucket assets               |
| `PUBLIC_ENDPOINT`           | Custom endpoint URL for the public bucket (if applicable)       |
| `B2_BUCKET_NAME`            | Alias bucket used by ZIP streaming and batch deletes — set to `STORAGE_BUCKET_NAME` |

### CDN

| Variable                    | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `CDN_PROVIDER`              | CDN routing mode: `"cloudflare"` (HMAC worker, SaaS only), `"cloudfront"` (AWS), or omit for direct S3 pre-signed URLs |
| `CDN_DOMAIN`                | Base URL of your CDN (Cloudflare Worker URL or CloudFront distribution domain)       |
| `CLOUDFLARE_WEBHOOK_SECRET` | Shared secret for the Cloudflare bandwidth webhook — SaaS required when `CDN_PROVIDER=cloudflare`; unused in self-hosted (server-side tracking) |
| `CLOUDFRONT_PRIVATE_KEY`    | RSA private key for CloudFront signed URLs (newlines as `\n`)                        |
| `CLOUDFRONT_PUBLIC_KEY_ID`  | CloudFront key pair ID associated with the private key                               |

### OAuth

| Variable                    | Description                               |
| --------------------------- | ----------------------------------------- |
| `GOOGLE_CLIENT_ID`          | Google OAuth app client ID                |
| `GOOGLE_CLIENT_SECRET`      | Google OAuth app client secret            |
| `GOOGLE_REDIRECT_URI`       | Callback URI for Google login             |
| `GOOGLE_DRIVE_REDIRECT_URI` | Callback URI for Google Drive integration |
| `GITHUB_CLIENT_ID`          | GitHub OAuth app client ID                |
| `GITHUB_CLIENT_SECRET`      | GitHub OAuth app client secret            |
| `GITHUB_REDIRECT_URI`       | Callback URI for GitHub login             |

### Payments (Razorpay — SaaS mode only)

| Variable                            | Description                          |
| ----------------------------------- | ------------------------------------ |
| `RAZORPAY_KEY_ID`                   | Razorpay key ID (live)               |
| `RAZORPAY_KEY_SECRET`               | Razorpay key secret (live)           |
| `RAZORPAY_WEBHOOK_SECRET`           | Razorpay webhook signing secret      |
| `TEST_RAZORPAY_KEY_ID`              | Razorpay key ID used when `NODE_ENV !== "production"` |
| `TEST_RAZORPAY_KEY_SECRET`          | Razorpay key secret used when `NODE_ENV !== "production"` |
| `TEST_RAZORPAY_WEBHOOK_SECRET`      | Webhook signing secret for test mode |
| `SUBSCRIPTION_PLAN_PRO_MONTHLY`     | Razorpay plan ID for PRO_MONTHLY     |
| `SUBSCRIPTION_PLAN_PRO_YEARLY`      | Razorpay plan ID for PRO_YEARLY      |
| `SUBSCRIPTION_PLAN_ULTRA_MONTHLY`   | Razorpay plan ID for ULTRA_MONTHLY   |
| `SUBSCRIPTION_PLAN_ULTRA_YEARLY`    | Razorpay plan ID for ULTRA_YEARLY    |
| `SUBSCRIPTION_PLAN_PREMIUM_MONTHLY` | Razorpay plan ID for PREMIUM_MONTHLY |
| `SUBSCRIPTION_PLAN_PREMIUM_YEARLY`  | Razorpay plan ID for PREMIUM_YEARLY  |
| `SUBSCRIPTION_PLAN_ELITE_MONTHLY`   | Razorpay plan ID for ELITE_MONTHLY   |
| `SUBSCRIPTION_PLAN_ELITE_YEARLY`    | Razorpay plan ID for ELITE_YEARLY    |
| `RAZORPAY_OFFER_*`                  | Single-use offer IDs applied as prorated upgrade credits |

### Email (BYO provider)

| Variable         | Description                                    |
| ---------------- | ---------------------------------------------- |
| `RESEND_API_KEY` | Resend API key — required when `EMAIL_PROVIDER=resend` |
| `FROM_EMAIL`     | Sender address (e.g. `noreply@yourdomain.com`)                              |
| `ADMIN_EMAIL`    | Inbox for admin/feedback alerts (optional)                                  |
| `EMAIL_PROVIDER` | `"resend"` (default, HTTP API) or `"smtp"` (any SMTP relay)                 |
| `SMTP_HOST`      | SMTP server host — required when `EMAIL_PROVIDER=smtp`                     |
| `SMTP_PORT`      | SMTP server port (default `587`)                                            |
| `SMTP_USER`      | SMTP username — required when `EMAIL_PROVIDER=smtp`                        |
| `SMTP_PASS`      | SMTP password — required when `EMAIL_PROVIDER=smtp`                        |
| `SMTP_SECURE`    | `"true"` for implicit TLS (port 465); omit for STARTTLS                    |

> **Email behavior by mode** — OTP and password-reset emails are sent in **all**
> modes (self-hosted login depends on the OTP email). Action/notification emails
> (share, ban/recover, feedback replies, invoice, abandoned-cart, subscription
> changes) are **SaaS-only** and are never attempted in self-hosted mode,
> regardless of the chosen provider.

### Misc

| Variable    | Description                                            |
| ----------- | ------------------------------------------------------ |
| `MAX_DEPTH` | Max nesting depth for recursive ZIP streaming (default `5` while `serve.js` uses `MAX_DEPTH || 5`) |

---

## Running the Project

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your values

# 3. Start
npm run dev      # development — hot reload via --watch
npm start        # production
```

Server starts on `http://localhost:4000` by default.

---

## API Overview

All authenticated routes require a valid `sessionId` signed cookie (set after OTP verification or OAuth login).

| Prefix                                | Description                                         | Auth             |
| ------------------------------------- | --------------------------------------------------- | ---------------- |
| `POST /api/auth/*`                    | Register, login, OTP, forgot-password               | ❌ Public         |
| `GET /api/oauth/*`                    | Google, GitHub, Google Drive OAuth flows            | ❌ / ✅ Mixed      |
| `GET /api/subscriptions/plans`        | Public pricing data                                   | ❌ Public        |
| `POST /api/subscriptions/webhook`     | Razorpay event webhook                              | ❌ HMAC-verified  |
| `POST /api/files/webhook`             | Cloudflare bandwidth webhook (SaaS only)                     | ❌ HMAC + SaaS |
| `GET /api/public/shared/:token`       | Public file preview / download / info               | ❌ Token-based    |
| `/api/files/*`                        | File CRUD, share, copy, trash, restore              | ✅ Session        |
| `/api/directories/*`                  | Directory CRUD, share, ZIP download                 | ✅ Session        |
| `/api/uploads/*`                      | Upload session initiate / complete / cancel         | ✅ Session        |
| `/api/user/*`                         | Profile, storage info, logout, bin, starred, shared | ✅ Session        |
| `/api/subscriptions/*`                | Subscription management (SaaS mode only)            | ✅ Session        |
| `/api/notifications/*`                | User notifications (list, read, mark-all-read)      | ✅ Session        |
| `/api/import/*`                       | Google Drive import pipeline                        | ✅ Session        |
| `/api/admin/*`                        | User management (admin/super_admin only)            | ✅ Session + Role |

Full request/response documentation for every endpoint is in the [`docs/`](./docs/) directory.

---

## Authentication Flow

The auth system uses a **2-step cookie handshake**:

```
1. POST /api/auth/login  (or /register)
   → validates credentials
   → sets short-lived authToken cookie (5 min, httpOnly, signed)
   → returns { isTwoFactorEnabled }

2a. If 2FA is disabled:
    POST /api/auth/request-otp
    → reads authToken cookie
    → sends 6-digit OTP to email (valid 5 min, stored in Redis)

    POST /api/auth/verify-otp
    → verifies OTP
    → creates session in Redis
    → sets sessionId cookie (7 days, httpOnly, signed)
    → returns user payload

2b. If 2FA is enabled:
    POST /api/auth/verify-totp
    → reads authToken cookie
    → verifies TOTP code from authenticator app
    → creates session in Redis
    → sets sessionId cookie (7 days, httpOnly, signed)
    → returns user payload
```

**2FA Setup** (authenticated users only):
```
GET  /api/auth/2fa/generate  → returns QR code + manual secret
POST /api/auth/2fa/enable    → verifies first TOTP code and activates 2FA
```

For OAuth (Google / GitHub), the browser navigates to `/api/oauth/<provider>/connect`, which redirects through the provider and back to the frontend with a `sessionId` cookie already set.

---

## Upload Flow

Uploads never pass through the backend server. The client uploads directly to S3/B2 using pre-signed PUT URLs.

```
1. POST /api/uploads/initiate
   → validates quota and plan file size limit
   → for files ≤ 5 MB: returns 1 pre-signed PUT URL (uploadType: "standard")
   → for files > 5 MB: creates S3 multipart upload, returns N pre-signed PUT URLs (uploadType: "multipart")

2. Client PUTs each chunk directly to S3/B2
   → collects ETag from each response header

3. PUT /api/uploads/complete/:id
   → sends [{ partNumber, ETag }] array + optional thumbnailBase64
   → backend calls CompleteMultipartUpload (multipart only)
   → creates UserFile record in MongoDB
   → increments ancestor directory sizes

4. DELETE /api/uploads/cancel/:id  (on failure)
   → aborts S3 multipart upload
   → deletes Redis session
```

---

## Subscription & Billing

Only active when `APP_MODE=saas`. All `/api/subscriptions/*` routes return `404` in self-hosted mode.

Plans (all available in monthly/yearly billing cycles): `FREE`, `PRO_MONTHLY`, `PRO_YEARLY`, `ULTRA_MONTHLY`, `ULTRA_YEARLY`, `PREMIUM_MONTHLY`, `PREMIUM_YEARLY`, `ELITE_MONTHLY`, `ELITE_YEARLY`.

Each plan enforces: storage quota, max file size, chunk size, upload concurrency, monthly bandwidth, max devices, trash retention days, and public link sharing capability.

**Upgrade flow** — a new Razorpay subscription is created immediately. If the user is within the first half of their billing cycle, a 50% prorated credit is applied as a Razorpay offer. The old subscription is cancelled by the `subscription.charged` webhook when the new one activates.

**Downgrade flow** — the existing subscription is updated with `schedule_change_at: "cycle_end"`. The `downgrade-executor` BullMQ job applies the plan change at renewal. Blocked if current storage usage exceeds the target plan's quota.

**Webhook** at `POST /api/subscriptions/webhook` handles all Razorpay subscription events. Also handles `invoice.paid` to store the invoice URL and send an email to the user.

---

## Google Drive Import

Requires the user to connect their Google Drive via `GET /api/oauth/google-drive/connect` first.

```
1. GET  /api/import/google/picker-token      → access token for Google Picker UI
2. POST /api/import/google/initiate          → create import session in Redis
3. PUT  /api/import/google/start-import/:id  → start async stream Drive → S3 (returns 202)
4. GET  /api/import/google/progress/:id      → poll status and byte progress
5. PUT  /api/import/google/complete/:id      → finalize: create UserFile in MongoDB
```

Google Docs/Sheets/Slides are exported to Office formats. Files that exceed Google's export size limit are saved as webview link references (size = 0).

---

## Background Jobs

BullMQ workers start automatically when the server starts. They connect to Redis using `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` env vars (separate from `REDIS_URL`).

| Job                      | Schedule          | Description                                                                  |
| ------------------------ | ----------------- | ---------------------------------------------------------------------------- |
| `downgrade-executor`     | Every hour        | Applies pending plan downgrades whose `currentPeriodEnd` has passed          |
| `cancel-executor`        | Every hour        | Drops users to FREE whose cancelled subscription `endedAt` has passed        |
| `trash-collector`        | Daily at 1am      | Permanently deletes files whose `permanentDeleteAt` has passed; cleans S3    |
| `quota-reaper`           | Daily at 1am      | Deletes oldest files for users still over quota after grace period ends      |
| `abandoned-cart-tracker` | Every 15 min      | Sends re-engagement email for subscriptions stuck in `"created"` for 30+ min |
| `share-token-invalidator`| Every hour        | Clears expired `shareToken`, `publicRole`, and `shareTokenExpiresAt` from files and directories |
| `bandwidth-reset`        | Daily at 3am      | Resets `usedBandwidthQuota` for users whose 30-day window has lapsed; notifies + busts Redis cache |
| `halted-subscription-reaper` | Daily at 2am  | Downgrades users whose Razorpay subscription has been halted for 7+ days back to FREE |
| `active-users-sweeper`   | Daily at 3am      | Prunes the Redis `storageApp:active_users` sorted set of users inactive 30+ days |

---

## Security

- **Cookies** — all cookies are `httpOnly`, `signed`, and `secure` in production.
- **CSRF** — `verifyCsrfOrigin` middleware checks `Origin`/`Referer` against `ALLOWED_ORIGINS` for all mutating requests in production.
- **Rate limiting** — four Redis-backed tiers: global (1000/15min), auth (20/15min), upload (100/15min), public-link (200/15min). Keyed by user ID when authenticated, IP otherwise.
- **Helmet** — sets standard security headers on all responses.
- **HMAC verification** — Razorpay webhook and Cloudflare bandwidth webhook both verify HMAC-SHA256 signatures before processing.
- **Passwords** — bcrypt with cost factor 12.
- **OAuth token encryption** — Google Drive and GitHub access/refresh tokens are encrypted at rest in MongoDB using AES-256-GCM.
- **OAuth** — PKCE (`S256`) used for all OAuth flows (Google, GitHub, Google Drive).
- **Session isolation** — each session is a separate Redis key; logout deletes only that key; logout-all deletes the entire session index.
