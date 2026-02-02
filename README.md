# 📦 Storage-App Backend

A powerful, production-ready backend service for cloud storage and file management.  
**Now enhanced with MongoDB, OAuth 2.0, Google Drive integration, and Admin & Sharing features (v3.1.0 — Admin & Sharing Release 🚀)**

---

## 🚧 Project Status
- MongoDB integration ✔ (v2.0 — completed)
- Google Drive integration ✔ (v3.0 — completed)
- OAuth 2.0 authentication ✔ (v3.0 — completed)
- OTP-based verification ✔ (v3.0 — completed)
- Session management & upload streaming ✔ (v3.0 — completed)
- Advanced cleanup jobs ✔ (v3.0 — completed)
- Admin & Sharing features ✔ (v3.1.0 — completed)

---

## 🧱 Tech Stack
- **Node.js** + **Express.js** — Backend framework
- **MongoDB** — Primary NoSQL database
- **Multer** — File upload handling & streaming
- **Google Drive API** — Cloud storage integration
- **OAuth 2.0** — Secure authentication
- **Node-cron** — Scheduled cleanup jobs
- **MIME type validation** — Security enforcement

---

## 📂 Main Features

### Core Features
- ✅ CRUD operations for files & directories
- ✅ **Soft delete with move-to-Bin and full restore support**
- ✅ **Recursive folder structure restoration**
- ✅ **Download folders as ZIP archives**
- ✅ **Secure file serving with content-type detection**

### Authentication & Security
- ✅ User registration & login with password hashing
- ✅ Cookie-based session management
- ✅ OAuth 2.0 integration with social providers
- ✅ OTP verification for sensitive operations
- ✅ Path traversal protection
- ✅ MIME type validation & enforcement

### Advanced Features
- ✅ **Google Drive file import & backup**
- ✅ **Upload session management with progress tracking**
- ✅ **Automatic cleanup of failed uploads & temp files**
- ✅ **Concurrent upload handling**
- ✅ **File streaming for large uploads**
- ✅ **File & directory sharing (share links, permissions)**
- ✅ **Admin endpoints for user and resource management**

---

## 📁 Directory Structure
```
/controllers    → Route handlers & business logic
/routes         → API endpoint definitions
/models         → MongoDB schema definitions
/middlewares    → Authentication, validation, error handling
/utils          → Utility functions (recursive ops, restore logic)
/jobs           → Scheduled cleanup tasks
/configs        → Database & app configuration
/uploads        → File storage directory
  ├── temp/     → Temporary upload files
app.js          → Server entry point
package.json    → Dependencies & scripts
```

---

## 🔧 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- MongoDB instance (local or cloud)
- Google OAuth credentials (optional, for Drive integration)

### Installation
```bash
# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your MongoDB URI and OAuth credentials

# Start the server
npm start

# Development with auto-reload
npm run dev
```

---

## 📡 API Overview

### 🔐 Authentication — `/auth`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/register` | Register new user `{ "name", "email", "password" }` |
| POST   | `/login` | Login & set session cookie `{ "email", "password" }` |
| POST   | `/request-otp` | Request OTP for verification `{ "email", "purpose" }` |
| POST   | `/verify-otp` | Verify OTP for sensitive operations `{ "email", "otp", "purpose" }` |
| POST   | `/forgot-password-init` | Start password reset verification (sets short-lived token cookie) `{ "email" }` |
| POST   | `/forgot-password` | Complete password reset using the OTP cookie `{ "newPassword" }` |

### 🔑 OAuth & Integration — `/oauth`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/google/connect` | Start Google OAuth (`/oauth/google/connect`) — sets PKCE & state cookies |
| GET    | `/google/callback` | OAuth callback for Google (`/oauth/google/callback`) — exchanges code for tokens and creates/links account |
| GET    | `/github/connect` | Start GitHub OAuth (`/oauth/github/connect`) — sets PKCE & state cookies |
| GET    | `/github/callback` | OAuth callback for GitHub (`/oauth/github/callback`) — exchanges code and creates/links account |
| GET    | `/google-drive/connect` | Start Google Drive OAuth (requires session) — used to acquire refresh token for drive integration |
| GET    | `/google-drive/callback` | Google Drive OAuth callback (`/oauth/google-drive/callback`) — stores refresh token in integration record |

### 📁 Directories — `/directories`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/:id` | List contents of the current (parent) directory — middleware loads parent directory context (`loadParentDir`) |
| GET    | `/all-files/:id` | List all files (flattened) under the loaded parent directory |
| GET    | `/download/:id` | Download directory as ZIP (`:id` is directory id) |
| GET    | `/info/:id` | Get basic info for a directory (`name`, `createdAt`, etc.) |
| POST   | `/new/:id` | Create directory in the current parent (`{ name }`) |
| POST   | `/rename/:id` | Rename directory `{"newname": "..."}` |
| POST   | `/move/:id` | Move directory to a different parent (`{"targetParentId": "..."}`) |
| POST   | `/share/:id` | Create a share link or change sharing settings for a directory |
| POST   | `/trash/:id` | Move directory to Bin (soft-delete) |
| POST   | `/restore/:id` | Restore directory from Bin |
| DELETE | `/delete/:id` | Permanently delete directory |

### 📄 Files — `/files`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/info/:id` | Get file (streams or responds according to request headers; use `/download/:id` to force attachment) |
| GET    | `/preview/:id` | Preview file inline (image/audio/video) — may require query `type=video|audio` and `force=true` for forced inline previews |
| GET    | `/download/:id` | Download file as attachment |
| PATCH  | `/rename/:id` | Rename file `{ "newname": "..." }` |
| PATCH  | `/move/:id` | Move file to target directory `{ "targetParentId": "..." }` |
| PATCH  | `/copy/:id` | Copy file to directory `{ "targetParentId": "..." }` |
| PATCH  | `/share/:id` | Create/update file share settings |
| POST   | `/trash/:id` | Move file to Bin (soft-delete) |
| POST   | `/restore/:id` | Restore file from Bin |
| DELETE | `/delete/:id` | Permanently delete file |

### 🏠 Home — `/home`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/bin` | List files & directories in user's bin |
| GET    | `/recents` | List recently updated files & directories |
| GET    | `/profile` | Get current user payload (sanitized) |
| POST   | `/logout` | Logout current session |
| POST   | `/logout-all` | Logout from all devices (clears sessions) |
| DELETE | `/delete-profile` | Delete user account and all data |
| GET    | `/link-google` | Link a Google account (starts OAuth flow) |
| GET    | `/link-github` | Link a GitHub account (starts OAuth flow) |

### ☁️ Google Drive Import — `/import`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/google-drive/picker-token` | Get Google Drive picker token (requires session; server uses stored refresh token to return a short-lived access token) |
| POST   | `/google-drive/backup` | Backup file(s) from Google Drive to your account (requires session; request body: `{ files: [{ id, name, mimeType, sizeBytes }], targetParentId }`) |

### 📤 Upload Sessions — `/uploads`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/session/create` | Create upload session — request body: `{ name, size, mime }` → returns `{ uploadId, strategy, chunkSize, totalChunks }` |
| GET    | `/session/:sessionId` | Get session status — response includes `status`, `progress`, `uploadedChunks`, `totalChunks` |
| POST   | `/session/:sessionId/chunk` | Upload file chunk — multipart form `file` field; include header `x-chunk-index` (zero-based) |
| POST   | `/session/:sessionId/complete` | Complete upload — triggers merge/finalize process; no body required |
| DELETE | `/session/:sessionId/cancel` | Cancel upload — attempts to remove temp chunk files and session record |

---

## 🔒 Security Features

- **Path Traversal Protection** — Prevents directory traversal attacks
- **MIME Type Validation** — Restricts file uploads based on type
- **Password Hashing** — Bcrypt for secure password storage
- **Session Management** — Secure cookie-based sessions with expiration
- **OAuth 2.0** — Secure third-party authentication
- **OTP Verification** — Additional security layer for sensitive ops
- **Error Handling** — Global error handler with safe error messages
- **Rate Limiting** — Built-in protection against brute force attacks

---

## 🚀 Performance Features

- **File Streaming** — Efficient handling of large file uploads
- **Chunked Uploads** — Support for resumable uploads
- **Concurrent Operations** — Handles multiple simultaneous requests
- **Database Indexing** — Optimized MongoDB queries
- **Cleanup Jobs** — Auto-removes orphaned/failed uploads
- **Compression** — ZIP compression for folder downloads

---

## 📋 Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Database
MONGODB_URI=mongodb://localhost:27017/storage-app
MONGODB_TEST_URI=mongodb://localhost:27017/storage-app-test

# Authentication
SESSION_SECRET=your_secret_key_here
JWT_SECRET=your_jwt_secret_here

# OAuth (Google)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=your_google_callback_url

# File Upload
MAX_FILE_SIZE=104857600 # 100MB
UPLOAD_DIR=./uploads
TEMP_DIR=./uploads/temp

# Cleanup Jobs
CLEANUP_INTERVAL=3600000 # 1 hour
TEMP_FILE_RETENTION=86400000 # 24 hours
```

---

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- authControllers.test.js
```

---

## 📚 API Response Format

All API responses follow a consistent format:

**Success Response (2xx):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation successful",
  "data": { ... }
}
```

**Error Response (4xx/5xx):**
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Error description",
  "error": "error_code"
}
```

---

## 🤝 Contribution Guidelines

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit changes: `git commit -m 'Add new feature'`
4. Push to branch: `git push origin feature/your-feature`
5. Submit a pull request

---

## 📝 Code Standards

- **Naming** — camelCase for variables/functions, PascalCase for classes
- **Comments** — JSDoc for functions, inline comments for logic
- **Error Handling** — Try-catch with meaningful error messages
- **Validation** — Input validation on all endpoints
- **Database** — Use models for all DB operations

---

## 🐛 Known Issues & Limitations

- File preview limited to certain formats (video, audio, images)
- Google Drive sync is one-way (import only, no real-time sync)
- Maximum file size configurable but limited by server resources
- ZIP download timeout for very large directories (>1000 files)

---

## 📞 Support & Contact

For issues, feature requests, or questions:
- Open an issue on GitHub
- Check existing documentation
- Review the CHANGELOG for recent updates

---

## 📄 License

This project is licensed under the MIT License — see LICENSE.md for details.

---

**Last Updated:** February 2026 | **Version:** 3.0.0


