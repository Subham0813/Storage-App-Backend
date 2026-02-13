# 📦 Storage‑App — Backend (Node + Express)

A production-ready backend for file & folder storage with resumable uploads, sharing, OAuth integrations and Google Drive import.

**Current version:** 3.1.0 — Admin & Sharing improvements ✅

---

## 🔍 Quick summary
- Uploads: resumable, chunked, and streamed
- Sharing: per-file / per-folder share links and permissions
- Integrations: Google & GitHub OAuth, Google Drive import/backup
- Security: signed session cookies, OTP verification, MIME checks
- Admin: user/resource management endpoints

---

## 📌 What's new (v3.1.0)
- Admin endpoints for user / resource management
- Improved sharing & permission propagation
- Stability fixes for import/upload session handling

---

## 🧱 Tech stack
- Node.js (ES modules) + Express
- MongoDB (mongoose)
- Multer (temporary chunk handling)
- Google APIs (Drive + OAuth)
- archiver (zip downloads)

---

## 📁 Project layout (important files)
- `app.js` — server entrypoint (default port: **4000**) and route mounting
- `routes/` — API routes (auth, uploads, files, directories, oauth, admin, import)
- `controllers/` — handlers for routes
- `models/` — Mongoose schemas
- `middlewares/` — session, validation, upload handling
- `utils/` — storage helpers, streaming, response helpers
- `jobs/` — scheduled cleanup tasks
- `uploads/` — storage root (contains `temp/` for chunk files)

---

## 🔧 Run locally
1. Install
   - `npm install`
2. Copy env and edit
   - `cp .env.example .env` (edit values)
3. Start
   - Production: `npm start` (runs `node app.js`)
   - Dev (auto-reload): `npm run dev`

Note: the server listens on port **4000** by default (see `app.js`). The dev script uses `node --env-file=.env --watch app.js`.

---

## ⚙️ Environment variables (used by this codebase)
Use the exact names below — they are referenced directly in source.

Required / common:
- `NODE_ENV` — development | production
- `MONGO_URI` — MongoDB connection string used by `configs/connect.js`
- `COOKIE_SECRET` — secret for signed cookies (`cookie-parser`)

OAuth / integrations:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` — OAuth callback for Google login
- `GOOGLE_DRIVE_REDIRECT_URI` — OAuth callback for Drive integration
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_REDIRECT_URI`

Storage / uploads (optional overrides):
- `TMP_ROOT` — temp chunk root (default: `./uploads/temp`)
- `UPLOAD_ROOT` — final upload root (default: `./uploads`)
- `MAX_FILE_SIZE` — maximum allowed upload size in bytes

Important notes:
- The app uses signed cookie sessions (`sid` cookie). `COOKIE_SECRET` must be set for session cookies to work.
- The server's CORS origin is set to `http://localhost:5173` by default (change in `app.js` if required).

---

## 🔐 Authentication & sessions
- Session store: `Session` model (signed `sid` cookie)
- OAuth: Google & GitHub (PKCE + state cookies)
- OTP: short-lived multi-purpose OTPs for sensitive operations

---

## 📡 Main API endpoints (high level)
- Auth: `/auth` — register, login, OTP, password reset
- OAuth: `/oauth` — Google / GitHub + Google Drive connect
- Files: `/files` — info, preview, download, rename, move, copy, share, trash, restore, delete
- Directories: `/directories` — list, create, download ZIP, rename, move, share, trash, restore, delete
- Upload sessions: `/uploads` — create session, upload chunk, complete, cancel, status
- Google Drive import: `/import/google-drive/backup` — import/backup files from Drive
- Admin: `/admin` — user/resource admin operations (requires admin privileges)

Refer to route files in `routes/` for complete signatures and request/response details.

---

## ✅ Response format
All endpoints return the same JSON envelope:

Success (2xx):
```
{ "success": true, "statusCode": 200, "message": "...", "data": { ... } }
```
Error (4xx/5xx):
```
{ "success": false, "statusCode": 400, "message": "...", "error": "ERROR_CODE" }
```

---

## 🧪 Tests
- No test runner is bundled in this workspace by default — run any available test scripts with `npm test` if present.

---

## 🛠 Development tips
- Code entry point: `app.js` (port 4000, CORS origin `http://localhost:5173`)
- Session cookie name: `sid` (signed; set `COOKIE_SECRET`)
- Upload temporary files live under `uploads/temp/` — cleanup jobs remove stale chunks
- To inspect active upload/import sessions, check `models/uploadSession.model.js`

---

Last updated: February 13, 2026 · Version: 3.1.0


