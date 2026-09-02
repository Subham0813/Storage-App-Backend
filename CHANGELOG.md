# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.0] - 2026-09-01 — Initial Public Release

> Previous `4.0.0` (2026-07) was internal iteration. First public launch is `1.0.0` — version reset. This entry reflects the actual **backend** codebase at `backendV3@7c3c505` with generic `https://example.com` examples. Frontend changes are tracked in `Storage-App-Frontend` changelog.

### Added

- **Response caching (Redis JSON, fail-open)** — `utils/responseCache.js` namespaces `storageApp:cache:user:{id}:info|usage|stats|plan` (60s, plan 30s) and `storageApp:cache:global:plans` (900s). Helper `cacheWrap` + `invalidateUser` busted on all mutating paths: `updateName/avatar`, upload `complete`, file/dir `delete`, `create/verify/update/cancel` subscription, admin quota, `razorpayWebhook`, `bandwidthWebhook`, BullMQ jobs.
- **Tiered feedback rate limiting (SaaS only)** — `POST /api/user/feedback` gated by `requireSaasMode` (selfhosted → `404`). Redis fixed 7-day window `storageApp:feedback:{userId}:count` with limits `FREE 2/week`, `PRO 5/week`, `BUSINESS 10/week`. On exceed `429` with tiered fallback: `FREE` → `https://github.com/Subham0813/Storage-App-Backend/issues`, `PRO`/`BUSINESS` → `mailto:support@example.com`. Screenshot `≤1 MB` to `feedback/{userId}/{now}.webp` in public bucket.
- **Google Drive integration hardening (backend)** — `revoke-drive-integration` now `POST https://oauth2.googleapis.com/revoke` best-effort + `del userdata` + `invalidateUser` idempotent; `getPickerTokenGoogle` busts `userdata` after refresh.
- **Billing hardening** — `middlewares/requireSaasMode.js` and `misc/constants.js:IS_SAAS_MODE` now `trim().toLowerCase() === "saas"` to tolerate `SAAS`/` saas `.
- **Sharing/ban emails for selfhosted** — ungated `sendSharingNotificationEmail`, `sendBulkSharingNotifications`, `sendAccountBannedEmail`, `sendAccountRecoveredEmail` in `services/emailService.js` so `SMTP`/`Resend` works outside `saas` when `FROM_EMAIL` is set.
- **Caching and quota tables** — documented in `README.md` with `PLAN_DETAILS` and `INSTANCE_CONFIG` divergence.

### Changed

- **Version** `4.0.0 → 1.0.0` in `package.json` and `README.md` badges — first public release.
- **Plans corrected** — internal `4.0.0` listed `ULTRA/PREMIUM/ELITE` (8 paid). Actual code is `FREE`, `PRO_MONTHLY/YEARLY`, `BUSINESS_MONTHLY/YEARLY` (4 paid) via `SUBSCRIPTION_PLAN_PRO_*` + `BUSINESS_*` and single `RAZORPAY_OFFER_*`. `README.md` and this changelog now reflect reality.
- **Job schedules corrected** — `jobs/queueJobs.js:604` `downgrade-executor` and `cancel-executor` are `0 0 * * *` daily midnight (not hourly), `share-token-invalidator` `0 0 * * *` (not hourly), `bandwidth-reset` `0 0 * * *`, `active-users-sweeper` `0 3 * * *`, `halted-reaper` `0 4 * * *`.
- **Email defaults** — `SUPPORT_EMAIL` default `support@example.com` (was `support@ownstorage.cloud`), `ADMIN_EMAIL` fallback to `FROM_EMAIL`, hardcoded `support@upstash.cloud` in `emailService.js:366` replaced by `ADMIN_EMAIL`.
- **Example domains** — all docs now use generic `https://example.com` / `https://api.example.com` / `support@example.com` instead of `ownstorage.space` / `thatsubhambachar.pro`.
- **`getUserStats`** cached 60s (self only), `getPlanOptions` 900s global, `getCurrentPlan` 30s per-user — previously uncached.
- **`getPickerTokenGoogle`** now busts `userdata` after refresh for fresh `expiryDate`.
- **`updateName/avatar`, `completeUpload`, `deleteFile/Directory`, `admin quota`, `razorpayWebhook`, `bandwidthWebhook`, `queueJobs`** all now call `invalidateUser`.

### Removed

- **Dead code** — `models/activity_log.model.js` (37 lines) and `utils/activityLogger.js` (27 lines), 77 lines in `controllers/commonSetControllers.js` unused, `routes` legacy aliases (`B2_BUCKET_NAME` kept as alias for ZIP only).
- **`4.0.0` internal plans** `ULTRA` etc. removed from docs — replaced by actual `PRO`/`BUSINESS`.

### Fixed

- `json.get` dereference bug in `utils/responseCache.js` — `value[0]` incorrectly unwrapped objects/arrays causing `GET /api/subscriptions/current-plan` to return `{"success":true}` without `data` on cache hit (second load). Now `value ?? null` and `cached != null` guard.
- `APP_MODE` case/whitespace handling for billing.

---

## [4.0.0] - 2026-07 — Internal (superseded by 1.0.0)

> Kept for history. See `1.0.0` above for corrected plans and schedules.

### Added

- Razorpay live subscription billing — full lifecycle: create, verify signature, upgrade, downgrade, cancel, and webhook sync (`subscription.charged`, `subscription.resumed`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `invoice.paid`).
- Prorated upgrade credits — 50% credit on unused billing days applied as a Razorpay offer during plan upgrades.
- Downgrade scheduling — plan downgrades are scheduled at `cycle_end` via Razorpay; blocked if current storage usage exceeds the target plan quota.
- Plan limits snapshot — `Subscription` model now stores a `limits` sub-document at creation time so quota enforcement is always based on the contracted plan, not live constants.
- `GET /api/subscriptions/current-plan` — returns active subscription details and current usage; returns FREE plan shape when no subscription exists.
- `GET /api/subscriptions/plans` — public pricing endpoint (SaaS mode only); auto-calculates yearly discount percentage from plan constants.
- `PATCH /api/subscriptions/update` — unified upgrade/downgrade endpoint with UPI mandate guard.
- `PATCH /api/subscriptions/cancel` — schedules end-of-cycle cancellation.
- Cloudflare CDN proxy for bandwidth tracking — preview and download URLs are now signed Cloudflare tokens (`/stream`, `/download`) instead of raw S3 pre-signed URLs; bandwidth is reported back via `POST /api/files/webhook`.
- `bandwidthWebhook` — internal Cloudflare Worker webhook that increments `usedBandwidthQuota` and `accessCount` on the user document after each served byte.
- Thumbnail upload on complete — `PUT /api/uploads/complete/:id` now accepts an optional `thumbnailBase64` (base64 webp) and stores it to S3 under `thumbnails/`.
- Standard upload type — files ≤ 5 MB use a single pre-signed PUT URL (`uploadType: "standard"`) instead of S3 multipart; `uploadId` is a random hex string in this case.
- `uploadType` field in upload session and initiate response so the client knows which path to take.
- `getShareInfo` field projection — response now returns `{ id, userId, grantedBy, permission }` per permission record; `onModel` and raw `itemId` are excluded.
- `getAllUsers` now uses `getUserPayload()` — admin user list returns the same normalized shape as `/api/user/info` plus a `sessionCount` field.
- `GET /api/admin/storage/:id` — returns `{ totalSize, totalFiles, totalDirs, breakdown }` with per-category (docs, images, videos, others) counts and sizes via MongoDB aggregation.
- `reason` field required on `PATCH /api/admin/remove-user/:id` — minimum 10 characters enforced.
- `revoke-drive-integration` — `PUT /api/user/revoke-drive-integration` clears stored Google Drive tokens.
- `active-users-sweeper` background job — prunes the Redis `storageApp:active_users` sorted set, removing users inactive for 30+ days. Runs daily at 3am.
- Public share routes under `/api/public/shared/:token` — unauthenticated preview, download, and info endpoints for publicly shared files.
- `verifyShareToken` middleware — validates share token path param, checks `publicRole`, `shareTokenExpiresAt`, and populates `req.Item`.
- `shareRoutes` mounted at `/api/public/shared` in `app.js`.
- `revokeAccess` controller — `PATCH /api/files/revoke-access/:id` and `PATCH /api/directories/revoke-access/:id` with optional email list, public link revocation, and notification emails.
- `newShareToken` controller — `PATCH /api/files/new-token/:id` and `PATCH /api/directories/new-token/:id` regenerate share tokens.
- `moveToBin` / `restoreItem` — `PUT /api/files/trash`, `PUT /api/files/restore`, `PUT /api/directories/trash`, `PUT /api/directories/restore` with recursive descendant handling for directories.
- `restrictRoot` middleware — blocks all mutating operations on the user's root directory.
- `loadParentDir` middleware — resolves and validates the target directory from `req.body.targetId`, populates `req.target` and `req.parent`.
- `checkAccess` middleware — unified ownership / permission / share-token access control for both files and directories.
- Google Drive import pipeline — `POST /api/import/google/initiate`, `PUT /api/import/google/start-import/:id`, `GET /api/import/google/progress/:id`, `PUT /api/import/google/complete/:id`, `GET /api/import/google/picker-token`.
- Google Drive OAuth — `GET /api/oauth/google-drive/connect` and `GET /api/oauth/google-drive/callback` store refresh token in `user.integrations.googleDrive`.
- PKCE for all OAuth flows — Google, GitHub, and Google Drive all use `code_challenge` / `code_verifier`.
- `verifyCsrfOrigin` middleware — checks `Origin`/`Referer` header against `ALLOWED_ORIGINS` for all mutating methods in production.
- Redis-backed rate limiting — global, auth, upload, and public-link limiters using `rate-limit-redis`.
- BYO email provider — `EMAIL_PROVIDER` selects the transport: `resend` (default, HTTP API) or `smtp` (any SMTP relay via `nodemailer`); provider credentials are validated conditionally at startup.
- SaaS-scoped notifications — action/notification emails (share, ban/recover, feedback, invoice, abandoned-cart, subscription changes) are only sent when `APP_MODE=saas`; OTP and password-reset emails remain active in all modes.
- SaaS-scoped Cloudflare bandwidth webhook — `POST /api/files/webhook` and the Cloudflare worker URL path are gated to SaaS mode; self-hosted instances track bandwidth server-side via the preview/download fallback.
- Comprehensive `.env.example` with all required and optional variables documented.
- Full API docs in `docs/` covering all route groups with exact request/response shapes, error tables, and implementation notes.

### Changed

- `getShareInfo` now uses `.select("itemId userId grantedBy permission")` and maps `itemId` → `id` in the formatted output; `onModel` is no longer returned.
- `getAllUsers` now calls `getUserPayload(user)` and appends `sessionCount` instead of building a raw object; response shape matches `/api/user/info`.
- `getUserStats` response changed from quota fields to `{ totalSize, totalFiles, totalDirs, breakdown }`.
- `copyFileHandler` now populates `userId` on the copy before returning via `getFileDoc`.
- `moveItem` response uses `id` (not `_id`) consistently.
- `renameItem` response uses `id` (not `_id`) consistently.
- `starredItem` response uses `id` (not `_id`) consistently.
- `newShareToken` response shape changed to `{ item: { id, newToken } }`.
- `revokeAccess` response now includes `{ item: getFileDoc(updatedItem), revoked: [...] }`.
- Upload `complete` response key changed from `file` → `item` to match all other endpoints.
- Import `complete` response key changed from `file` → `item`.
- `deleteDirectoryHandler` response uses `_id` (raw from controller) in `data.item`.
- `createDirectoryHandler` body field is `targetId` (resolved by `loadParentDir`), not `parentId`.
- `tempRemoveUser` now requires `reason` in request body (min 10 chars).
- `cancelSubscriptionPlan` error path returns `500` with a support message instead of propagating the raw Razorpay error.
- `app.js` — `GET /api/subscriptions/plans` (pricing) is mounted as a standalone anonymous public route (before `validateSession`), so the pricing endpoint works without a session in both modes.
- `app.js` — `POST /api/subscriptions/webhook` and `POST /api/files/webhook` mounted before `validateSession`; the files (Cloudflare bandwidth) webhook is now also gated to SaaS mode via `requireSaasMode`.
- All docs in `docs/` fully rewritten and verified against actual controller output.

### Fixed

- `share-info` response had broken JSON (missing comma, wrong field names `onModel`/`itemId`).
- Admin user list shape had stale fields (`sessions`, `root`, raw `authProviders` array).
- `storage` doc described wrong response shape (quota fields instead of aggregation result).
- `update-name` body documented incorrectly (nested object vs. flat `{ name }`).
- `uploadRouteRequestResponse.md` described `file` key in complete response instead of `item`.
- `importDriveRouteRequestResponse.md` described `file` key in complete response instead of `item`.
- `paymentRouteRequestResponse.md` listed wrong endpoint path (`/api/payments/plans` vs. `/api/subscriptions/plans`).
- `directoryRouteRequestResponse.md` listed `parentId` as the body field for `POST /new` instead of `targetId`.

---

## [3.1.0] - 2026-02-02

### Added

- Admin API surface under `/admin` for user listing, role change, forced logout, soft delete/recover, and permanent remove.
- Sharing APIs for files and directories with `publicRole`, per-email access control, and generated share tokens.
- Guest token authorization path in `validateSession` (`?token=`) for shared file/directory access.
- Home routes under `/home` (`/bin`, `/recents`, `/shared`, `/user`, logout flows, profile delete).
- Auth extensions for password reset: `/auth/forgot-password-init` and `/auth/forgot-password`.
- Upload-session middleware hardening and dedicated loader for session ownership checks.
- Google Drive import endpoints under `/import/google-drive/*` with upload-session tracking.
- New utility modules for sharing and storage orchestration.

### Changed

- API route style aligned around action-first paths (e.g. `files/info/:id`, `directories/rename/:id`, `directories/new`).
- Session validation now supports signed-cookie auth and share-token based guest access in one middleware.
- Upload pipeline updated to role-based chunk sizes and explicit session status progression.
- Directory and file controllers expanded for permission-aware share/move/bin/restore operations.
- Environment setup clarified with `.env.example` and removal of hard-coded sensitive placeholders.
- Package version bumped to `3.1.0`.

### Fixed

- Multiple controller/middleware consistency fixes across auth, upload, file, and directory flows.
- Security hygiene improvements around session/cookie handling and configuration defaults.

---

## [3.0.0] - 2026-01

### Added

- Google Drive integration for file imports and backups.
- OAuth 2.0 support (Google and GitHub).
- OTP verification for auth-sensitive operations.
- Upload session management with chunk tracking.
- Background cleanup jobs for failed/temporary upload artifacts.

### Changed

- Improved upload middleware and session lifecycle handling.
- Refactored middleware/controller flow for stronger request validation.
- Performance and reliability improvements for file serving and DB operations.

### Fixed

- Path traversal and file serving edge cases.
- Error propagation through middleware stack.
- Concurrent upload/session stability issues.

---

## [2.0.0] - 2026-01

### Added

- MongoDB migration for files/directories/session data.
- Recursive bin/restore behavior.
- Validation schemas and helper utilities for cleaner controller logic.

### Changed

- CRUD controllers fully migrated from JSON storage to MongoDB.
- Route/controller structure reorganized for maintainability.

### Removed

- Legacy JSON DB storage and old bin/restore logic.

