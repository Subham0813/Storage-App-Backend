# 📦 Storage-App Backend

A production-ready cloud storage and file management backend built with Node.js, Express, and MongoDB.  
**Features MongoDB integration, OAuth 2.0 authentication, Google Drive API integration, and advanced file management (v3.0)**

---

## 🚧 Project Status
- ✅ MongoDB integration (v2.0)
- ✅ Google Drive integration (v3.0)
- ✅ OAuth 2.0 authentication with Google & GitHub (v3.0)
- ✅ OTP-based verification (v3.0)
- ✅ Session management & upload streaming (v3.0)
- ✅ Automatic cleanup jobs (v3.0)
- ✅ Chunked file uploads with progress tracking

---

## 🧱 Tech Stack
- **Node.js** + **Express.js** — Fast, unopinionated backend framework
- **MongoDB** — NoSQL document database with Mongoose ODM
- **Multer** — Multipart/form-data handling for file uploads
- **Google APIs** — Google Drive and OAuth 2.0 integration
- **Bcrypt** — Password hashing & verification
- **Archiver** — ZIP compression for folder downloads
- **MIME Type Detection** — File-type validation & security

---

## 📂 Main Features

### 🗂️ File & Directory Management
- Full CRUD operations for files and directories
- Soft delete with trash/bin functionality
- One-click restore with full recursive directory restoration
- Move, copy, and rename operations
- Folder download as ZIP archives with compression
- Secure file serving with content-type detection

### 🔐 Authentication & Authorization
- User registration with email validation
- Secure login with bcrypt password hashing
- Session-based authentication with cookies
- OAuth 2.0 integration (Google, GitHub)
- OTP verification for sensitive operations
- Password reset functionality via email
- Account deletion with cascade data removal

### 📤 Advanced Upload System
- Chunked file uploads for large files (>100MB)
- Upload session management with resumable uploads
- Real-time upload progress tracking
- Concurrent multi-file upload support
- Automatic cleanup of failed upload sessions
- Temporary file auto-cleanup after 24 hours

### ☁️ Cloud Integration
- Google Drive OAuth integration
- Import files from Google Drive
- Google Drive backup support
- Two-way OAuth linking

### 🛡️ Security Features
- Path traversal attack prevention
- MIME type validation on all uploads
- Bcrypt password hashing with salt rounds
- Secure session cookies with expiration
- Error message sanitization
- Database schema validation
- Root directory operation restrictions

---

## 📁 Directory Structure
```
backend/
├── controllers/          # Route logic & business operations
│   ├── authControllers.js         # Auth, register, login, OTP
│   ├── fileControllers.js         # File CRUD operations
│   ├── directoryControllers.js    # Directory CRUD operations
│   ├── uploadControllers.js       # Chunked upload management
│   ├── importDriveController.js   # Google Drive imports
│   ├── homeRouteControllers.js    # Home, root, recents, bin
│   └── oauthControllers.js        # OAuth handlers
├── routes/              # Express route definitions
│   ├── authRoutes.js              # /auth endpoints
│   ├── fileRoutes.js              # /files endpoints
│   ├── directoryRoutes.js         # /directories endpoints
│   ├── uploadRoutes.js            # /uploads endpoints
│   ├── homeRoutes.js              # / endpoints (profile, root, bin)
│   ├── importDriveRoutes.js       # /import-drive endpoints
│   └── oauthRoutes.js             # /oauth endpoints
├── models/              # MongoDB schemas
│   ├── user.model.js
│   ├── file.model.js
│   ├── directory.model.js
│   ├── session.model.js
│   ├── uploadSession.model.js
│   ├── otp.model.js
│   ├── integration.model.js
│   └── user_file.model.js
├── middlewares/         # Express middleware functions
│   ├── validateSession.js         # Auth middleware
│   ├── errorHandler.js            # Global error handler
│   ├── upload.js                  # Multer configuration
│   ├── loadUploadSession.js       # Load upload session
│   ├── loadParentDirectory.js     # Parent dir validation
│   └── restrictRootOperations.js  # Root protection
├── jobs/                # Scheduled cleanup tasks
│   ├── cleanupTempUploads.js      # Remove orphaned files
│   └── cleanupFailedUploadSessions.js
├── utils/               # Utility functions
│   ├── createSession.js           # Session creation
│   ├── helper.js                  # Response helpers
│   ├── remove.js                  # File removal logic
│   ├── restore.js                 # Restore logic
│   └── serve.js                   # File serving logic
├── configs/             # Configuration files
│   ├── db.js                      # MongoDB connection
│   ├── connect.js                 # Connection setup
│   ├── mimeSet.js                 # MIME type whitelist
│   └── dbSchemaValidation.js      # Schema validation
├── uploads/             # File storage
│   ├── temp/                      # Temporary uploads
│   └── google-drive-imports/      # GDrive imports
├── public/              # Static files (if any)
├── app.js               # Express app setup & routes
├── package.json         # Dependencies & scripts
└── README.md            # This file
```

---

## 🔧 Getting Started

### Prerequisites
- **Node.js** v14+ or v16+ (with npm)
- **MongoDB** v4.0+ (local, Docker, or Atlas)
- **Google OAuth Credentials** (optional, for Drive integration)
  - Google Client ID & Secret
  - Redirect URI configured

### Installation

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

4. **Initialize database**
   ```bash
   npm run validate-db  # Validates schema
   ```

5. **Start the server**
   ```bash
   # Production
   npm start

   # Development (with auto-reload)
   npm run dev
   ```

The server will start on `http://localhost:3000` (or configured PORT).

---

## 📡 API Endpoints & Response Format

### 🔐 Authentication Routes — `/auth`

#### POST `/auth/register`
Register a new user account.

**Request Body:**
```json
{
  "fullname": "John Doe",
  "email": "john@example.com",
  "password": "securePassword123"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "User registered successfully. You can now login.",
  "data": {
    "user": {
      "_id": "507f1f77bcf86cd799439011",
      "email": "john@example.com",
      "fullname": "John Doe",
      "createdAt": "2026-01-27T10:30:00.000Z"
    }
  }
}
```

**Error Response (409):**
```json
{
  "success": false,
  "statusCode": 409,
  "message": "User already registered.",
  "error": "DUPLICATE_USER"
}
```

---

#### POST `/auth/login`
Login with email and password.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "securePassword123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Login successful.",
  "data": {
    "user": {
      "_id": "507f1f77bcf86cd799439011",
      "email": "john@example.com",
      "fullname": "John Doe"
    },
    "session": {
      "sessionId": "sess_xyz123",
      "expiresAt": "2026-02-27T10:30:00.000Z"
    }
  }
}
```

**Cookies Set:**
- `authToken`: Signed JWT session cookie (expires in 30 days)

---

#### POST `/auth/request-otp`
Request a One-Time Password for sensitive operations.

**Request Body:**
```json
{
  "email": "john@example.com",
  "purpose": "password_reset" // or "verification"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "An One Time Password has been sent to your Email address.",
  "data": {
    "expiresAt": 1706333400000
  }
}
```

---

#### POST `/auth/verify-otp`
Verify OTP for password reset or account operations.

**Request Body:**
```json
{
  "email": "john@example.com",
  "otp": "123456",
  "purpose": "password_reset"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "OTP verified successfully.",
  "data": {
    "verificationToken": "verify_token_xyz"
  }
}
```

---

#### POST `/auth/forgot-password-init`
Initiate forgot password flow.

**Request Body:**
```json
{
  "email": "john@example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password reset email sent. Check your inbox."
}
```

---

#### POST `/auth/forgot-password`
Reset password with verification token.

**Request Body:**
```json
{
  "email": "john@example.com",
  "newPassword": "newSecurePassword123",
  "token": "verify_token_xyz"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password updated successfully. Please login again."
}
```

---

#### POST `/auth/logout`
Logout and clear session. (Requires authentication)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Logout successful."
}
```

---

#### POST `/auth/logout-all`
Logout from all sessions. (Requires authentication)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Logged out from all sessions."
}
```

---

#### DELETE `/auth/profile`
Permanently delete user account and all associated data. (Requires authentication)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "User profile deleted successfully."
}
```

---

### 🏠 Home Routes — `/`

#### GET `/profile`
Get authenticated user's profile. (Requires authentication)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "user": {
      "_id": "507f1f77bcf86cd799439011",
      "email": "john@example.com",
      "fullname": "John Doe",
      "rootDirId": "dir_xyz",
      "integrations": {
        "google": { "connected": true, "email": "john@google.com" },
        "github": { "connected": false }
      }
    }
  }
}
```

---

#### GET `/root`
Get root directory contents. (Requires authentication)

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `sort`: Sort field (default: `name`)
- `order`: `asc` or `desc` (default: `asc`)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "directory": {
      "_id": "dir_root_123",
      "userId": "507f1f77bcf86cd799439011",
      "name": "Root",
      "parentId": null,
      "isTrash": false,
      "createdAt": "2025-01-01T00:00:00.000Z"
    },
    "items": [
      {
        "_id": "file_123",
        "type": "file",
        "name": "document.pdf",
        "mimeType": "application/pdf",
        "size": 2048576,
        "createdAt": "2026-01-27T10:30:00.000Z"
      },
      {
        "_id": "dir_456",
        "type": "directory",
        "name": "Projects",
        "itemCount": 5,
        "createdAt": "2026-01-26T14:20:00.000Z"
      }
    ],
    "pagination": {
      "totalItems": 25,
      "totalPages": 2,
      "currentPage": 1,
      "itemsPerPage": 20
    }
  }
}
```

---

#### GET `/bin`
Get trash/bin directory contents. (Requires authentication)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "binItems": [
      {
        "_id": "file_deleted_123",
        "type": "file",
        "name": "old_file.txt",
        "originalPath": "/Documents/old_file.txt",
        "deletedAt": "2026-01-25T10:30:00.000Z",
        "expiresAt": "2026-04-25T10:30:00.000Z"
      }
    ],
    "totalItems": 5
  }
}
```

---

#### GET `/recents`
Get recently accessed/modified files and directories. (Requires authentication)

**Query Parameters:**
- `limit`: Number of recent items (default: 10, max: 50)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "recentItems": [
      {
        "_id": "file_123",
        "type": "file",
        "name": "report.xlsx",
        "lastAccessedAt": "2026-01-27T10:30:00.000Z",
        "size": 512000
      }
    ],
    "count": 10
  }
}
```

---

### 🔑 OAuth Routes — `/oauth`

#### GET `/oauth/google/connect`
Initiate Google OAuth authentication flow.

**Redirects to:** Google OAuth consent screen

**Callback:** Stores Google credentials and creates session

---

#### GET `/oauth/google/callback`
Google OAuth callback endpoint. (Handled automatically)

**Query Parameters:**
- `code`: Authorization code from Google
- `state`: CSRF protection token

**Redirects to:** Frontend home page with session cookie set

---

#### GET `/oauth/github/connect`
Initiate GitHub OAuth authentication flow.

**Redirects to:** GitHub OAuth authorization page

---

#### GET `/oauth/github/callback`
GitHub OAuth callback endpoint. (Handled automatically)

---

#### GET `/oauth/google-drive/connect`
Initiate Google Drive OAuth flow. (Requires authentication)

**Purpose:** Grant Drive API access for file import/backup

---

#### GET `/oauth/google-drive/callback`
Google Drive OAuth callback. (Handled automatically)

---

### 📁 Directory Routes — `/directories`

#### POST `/directories/`
Create a new directory at root. (Requires authentication)

**Request Body:**
```json
{
  "name": "New Folder"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Directory created successfully.",
  "data": {
    "directory": {
      "_id": "dir_new_123",
      "userId": "507f1f77bcf86cd799439011",
      "name": "New Folder",
      "parentId": "dir_root_123",
      "createdAt": "2026-01-27T10:35:00.000Z"
    }
  }
}
```

---

#### GET `/directories/:id`
Get directory contents with pagination. (Requires authentication)

**Path Parameters:**
- `id`: Directory ID

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `sortBy`: Sort field (default: `name`)
- `sortOrder`: `asc` or `desc`
- `type`: Filter by type (`file`, `directory`, or both)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "directory": {
      "_id": "dir_123",
      "name": "Projects",
      "itemCount": 12,
      "createdAt": "2026-01-20T09:00:00.000Z"
    },
    "contents": [
      {
        "_id": "file_123",
        "type": "file",
        "name": "report.pdf",
        "mimeType": "application/pdf",
        "size": 1048576,
        "createdAt": "2026-01-27T10:30:00.000Z"
      },
      {
        "_id": "dir_456",
        "type": "directory",
        "name": "SubFolder",
        "itemCount": 3,
        "createdAt": "2026-01-26T14:20:00.000Z"
      }
    ],
    "pagination": {
      "totalItems": 12,
      "totalPages": 1,
      "currentPage": 1
    }
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "statusCode": 404,
  "message": "Directory not found.",
  "error": "NOT_FOUND"
}
```

---

#### GET `/directories/download/:id`
Download directory as ZIP file. (Requires authentication)

**Path Parameters:**
- `id`: Directory ID

**Success Response (200):**
- File attachment header: `Content-Disposition: attachment; filename="DirectoryName.zip"`
- Content-Type: `application/zip`
- Response body: ZIP file stream

**Error Response (400):**
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Directory is too large to download.",
  "error": "SIZE_LIMIT_EXCEEDED"
}
```

---

#### POST `/directories/:id/rename`
Rename a directory. (Requires authentication, Cannot rename root)

**Path Parameters:**
- `id`: Directory ID

**Request Body:**
```json
{
  "newname": "Renamed Folder"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Directory renamed successfully.",
  "data": {
    "directory": {
      "_id": "dir_123",
      "name": "Renamed Folder",
      "updatedAt": "2026-01-27T10:35:00.000Z"
    }
  }
}
```

---

#### POST `/directories/:id/move`
Move directory to another location or root. (Requires authentication, Cannot move root)

**Path Parameters:**
- `id`: Directory ID to move

**Request Body:**
```json
{
  "dirId": "dir_target_456"  // Target parent directory ID, or null for root
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Directory moved successfully.",
  "data": {
    "directory": {
      "_id": "dir_123",
      "name": "Folder Name",
      "parentId": "dir_target_456"
    }
  }
}
```

---

#### POST `/directories/:id/trash`
Move directory to trash. (Requires authentication, Cannot trash root)

**Path Parameters:**
- `id`: Directory ID

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Directory moved to trash.",
  "data": {
    "directory": {
      "_id": "dir_123",
      "isTrash": true,
      "trashedAt": "2026-01-27T10:35:00.000Z"
    }
  }
}
```

---

#### POST `/directories/:id/restore`
Restore directory from trash with all contents. (Requires authentication)

**Path Parameters:**
- `id`: Directory ID in trash

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Directory restored successfully with all contents.",
  "data": {
    "directory": {
      "_id": "dir_123",
      "name": "Restored Folder",
      "isTrash": false
    },
    "filesRestored": 5,
    "subdirectoriesRestored": 2
  }
}
```

---

#### DELETE `/directories/delete/:id`
Permanently delete a directory and all contents. (Requires authentication, Cannot delete root)

**Path Parameters:**
- `id`: Directory ID

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Directory permanently deleted.",
  "data": {
    "deletedItems": 12,
    "deletedDirectories": 2
  }
}
```

---

### 📄 File Routes — `/files`

#### GET `/files/metadata/:id`
Get file metadata without downloading. (Requires authentication)

**Path Parameters:**
- `id`: File ID

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "file": {
      "_id": "file_123",
      "name": "document.pdf",
      "mimeType": "application/pdf",
      "size": 2048576,
      "uploadedBy": "507f1f77bcf86cd799439011",
      "uploadedAt": "2026-01-27T10:30:00.000Z",
      "lastModified": "2026-01-27T10:30:00.000Z",
      "directoryId": "dir_123"
    }
  }
}
```

---

#### GET `/files/preview/:id`
Stream file preview (video, audio, or image). (Requires authentication)

**Path Parameters:**
- `id`: File ID

**Query Parameters:**
- `type`: `video`, `audio`, or `image`
- `prev`: `yes` for preview mode (returns low-quality stream)

**Success Response (206 or 200):**
- Content-Type: Matches file MIME type
- Content-Range: For video/audio preview
- Response body: File stream

**Example Request:**
```
GET /files/preview/file_123?type=video&prev=yes
```

**Error Response (415):**
```json
{
  "success": false,
  "statusCode": 415,
  "message": "Preview not available for this file type.",
  "error": "UNSUPPORTED_MEDIA_TYPE"
}
```

---

#### GET `/files/download/:id`
Download file with original filename. (Requires authentication)

**Path Parameters:**
- `id`: File ID

**Success Response (200):**
- Header: `Content-Disposition: attachment; filename="filename.ext"`
- Content-Type: File MIME type
- Response body: File stream

---

#### PATCH `/files/rename/:id`
Rename a file. (Requires authentication)

**Path Parameters:**
- `id`: File ID

**Request Body:**
```json
{
  "newname": "new_filename.pdf"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "File renamed successfully.",
  "data": {
    "file": {
      "_id": "file_123",
      "name": "new_filename.pdf"
    }
  }
}
```

---

#### PATCH `/files/copy/:id`
Create a copy of file to target directory. (Requires authentication)

**Path Parameters:**
- `id`: File ID

**Request Body:**
```json
{
  "dirId": "dir_target_456"  // Target directory ID, or null for root
}
```

**Success Response (201):**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "File copied successfully.",
  "data": {
    "file": {
      "_id": "file_copy_789",
      "name": "document_copy.pdf",
      "directoryId": "dir_target_456",
      "size": 2048576
    }
  }
}
```

---

#### PATCH `/files/move/:id`
Move file to another directory or root. (Requires authentication)

**Path Parameters:**
- `id`: File ID

**Request Body:**
```json
{
  "dirId": "dir_target_456"  // Target directory ID, or null for root
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "File moved successfully.",
  "data": {
    "file": {
      "_id": "file_123",
      "name": "document.pdf",
      "directoryId": "dir_target_456"
    }
  }
}
```

---

#### POST `/files/trash/:id`
Move file to trash. (Requires authentication)

**Path Parameters:**
- `id`: File ID

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "File moved to trash.",
  "data": {
    "file": {
      "_id": "file_123",
      "name": "document.pdf",
      "isTrash": true,
      "trashedAt": "2026-01-27T10:35:00.000Z"
    }
  }
}
```

---

#### POST `/files/restore/:id`
Restore file from trash. (Requires authentication)

**Path Parameters:**
- `id`: File ID in trash

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "File restored successfully.",
  "data": {
    "file": {
      "_id": "file_123",
      "name": "document.pdf",
      "isTrash": false
    }
  }
}
```

---

#### DELETE `/files/delete/:id`
Permanently delete a file. (Requires authentication)

**Path Parameters:**
- `id`: File ID

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "File permanently deleted.",
  "data": {
    "file": {
      "_id": "file_123",
      "name": "document.pdf",
      "size": 2048576
    }
  }
}
```

---

### 📤 Upload Routes — `/uploads`

#### POST `/uploads/session/create`
Initiate a new chunked upload session. (Requires authentication)

**Request Body:**
```json
{
  "filename": "large_video.mp4",
  "filesize": 1073741824,
  "mimeType": "video/mp4",
  "dirId": "dir_123"  // Optional, null for root
}
```

**Success Response (201):**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "Upload session created successfully.",
  "data": {
    "session": {
      "sessionId": "upload_sess_abc123",
      "filename": "large_video.mp4",
      "filesize": 1073741824,
      "chunkSize": 5242880,
      "totalChunks": 205,
      "uploadedChunks": 0,
      "createdAt": "2026-01-27T10:35:00.000Z",
      "expiresAt": "2026-01-28T10:35:00.000Z"
    }
  }
}
```

---

#### GET `/uploads/session/:sessionId`
Get current upload session status and progress. (Requires authentication)

**Path Parameters:**
- `sessionId`: Upload session ID

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "session": {
      "sessionId": "upload_sess_abc123",
      "filename": "large_video.mp4",
      "filesize": 1073741824,
      "uploadedBytes": 262144000,
      "uploadedChunks": 50,
      "totalChunks": 205,
      "progress": 24.4,
      "status": "in_progress",
      "createdAt": "2026-01-27T10:35:00.000Z",
      "expiresAt": "2026-01-28T10:35:00.000Z"
    }
  }
}
```

---

#### POST `/uploads/session/:sessionId/chunk`
Upload a single file chunk. (Requires authentication)

**Path Parameters:**
- `sessionId`: Upload session ID

**Form Data:**
- `file`: Binary chunk data (multipart/form-data)
- `chunkIndex`: Chunk number (0-indexed)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Chunk uploaded successfully.",
  "data": {
    "session": {
      "sessionId": "upload_sess_abc123",
      "uploadedChunks": 51,
      "totalChunks": 205,
      "progress": 24.88,
      "uploadedBytes": 267386880
    }
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Invalid chunk index or chunk already uploaded.",
  "error": "INVALID_CHUNK"
}
```

---

#### POST `/uploads/session/:sessionId/complete`
Mark upload session as complete and finalize file. (Requires authentication)

**Path Parameters:**
- `sessionId`: Upload session ID

**Request Body:**
```json
{
  "filename": "large_video.mp4"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "File uploaded and saved successfully.",
  "data": {
    "file": {
      "_id": "file_new_123",
      "name": "large_video.mp4",
      "mimeType": "video/mp4",
      "size": 1073741824,
      "uploadedAt": "2026-01-27T10:45:00.000Z",
      "directoryId": "dir_123"
    }
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Not all chunks have been uploaded.",
  "error": "INCOMPLETE_UPLOAD",
  "data": {
    "uploadedChunks": 204,
    "totalChunks": 205,
    "missingChunks": [204]
  }
}
```

---

#### DELETE `/uploads/session/:sessionId/cancel`
Cancel and cleanup an upload session. (Requires authentication)

**Path Parameters:**
- `sessionId`: Upload session ID

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Upload session cancelled and temporary files cleaned up.",
  "data": {
    "sessionId": "upload_sess_abc123",
    "uploadedChunks": 50,
    "cleanedUpBytes": 262144000
  }
}
```

---

### ☁️ Import Drive Routes — `/import-drive`

#### GET `/import-drive/google-drive/picker-token`
Get Google Drive picker token for file selection. (Requires authentication + Drive OAuth)

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "token": "ya29.a0AfH6SMBx...",
    "expiresIn": 3600
  }
}
```

---

#### POST `/import-drive/google-drive/backup`
Import files from Google Drive to storage. (Requires authentication + Drive OAuth)

**Request Body:**
```json
{
  "fileIds": ["1ABC2DEF3GHI", "4JKL5MNO6PQR"],
  "dirId": "dir_123"  // Optional, null for root
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Files imported from Google Drive successfully.",
  "data": {
    "importedFiles": [
      {
        "_id": "file_imported_123",
        "name": "document.pdf",
        "size": 2048576,
        "mimeType": "application/pdf",
        "importedAt": "2026-01-27T10:45:00.000Z"
      }
    ],
    "totalImported": 2,
    "totalSize": 3145728
  }
}
```

---

## 📊 Standard Response Format

All API responses follow a consistent JSON structure for predictable client handling.

### Success Response (2xx)
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Operation completed successfully",
  "data": {
    // Response-specific data object
  }
}
```

**Common Status Codes:**
- `200` — OK: Successful GET/PATCH/POST
- `201` — Created: Resource created successfully
- `204` — No Content: Successful operation with no response data

---

### Error Response (4xx/5xx)
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Descriptive error message",
  "error": "ERROR_CODE"
}
```

**Common Error Codes:**
- `400` — Bad Request: Invalid input or payload
- `401` — Unauthorized: Missing or invalid authentication
- `403` — Forbidden: Insufficient permissions
- `404` — Not Found: Resource not found
- `409` — Conflict: Resource already exists
- `413` — Payload Too Large: File exceeds size limit
- `415` — Unsupported Media Type: Invalid MIME type
- `500` — Internal Server Error: Server-side error

**Common Error Codes in Responses:**
- `INVALID_PAYLOAD` — Missing or malformed request data
- `UNAUTHORIZED` — No valid session/token
- `FORBIDDEN` — Operation not allowed for this resource
- `NOT_FOUND` — Resource doesn't exist
- `DUPLICATE_USER` — Email already registered
- `INVALID_CREDENTIALS` — Wrong password or email
- `SESSION_EXPIRED` — Session token expired
- `UNSUPPORTED_MEDIA_TYPE` — File type not allowed
- `SIZE_LIMIT_EXCEEDED` — File too large
- `INCOMPLETE_UPLOAD` — Missing chunks in upload
- `OPERATION_NOT_ALLOWED` — Cannot perform on root directory

---

## 🔒 Security Features

### Authentication & Session
- **Bcrypt Hashing** — Passwords hashed with 10 salt rounds
- **Signed Cookies** — Session tokens signed with secret key
- **Session Expiration** — Auto-expires after 30 days
- **OTP Verification** — 6-digit OTP with 5-minute validity
- **Multi-device Logout** — Logout-all terminates all sessions

### Data Protection
- **Path Traversal Prevention** — Validates all file/directory paths
- **MIME Type Validation** — Whitelist-based file type checking
- **Duplicate Email Prevention** — Unique email constraint
- **Cascade Delete** — Removes orphaned files on user deletion
- **Soft Delete** — Trash functionality with recovery window

### API Security
- **Error Message Sanitization** — Hides sensitive details from clients
- **CSRF Protection** — OAuth state parameter validation
- **Request Validation** — Input schema validation via Mongoose
- **Rate Limiting** — Prevent brute force (configurable)
- **Secure Headers** — CORS and content-type enforcement

---

## 🚀 Performance Optimization

- **Database Indexing** — Indexed queries on frequently-used fields
- **Chunked Uploads** — Support for resumable large file uploads
- **Streaming** — Stream-based file serving for large files
- **Compression** — ZIP compression for folder downloads
- **Pagination** — Limit dataset with page-based loading
- **Caching** — Session & OTP caching strategies

---

## 📋 Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# ========== SERVER CONFIGURATION ==========
NODE_ENV=development          # development, staging, production
PORT=3000                     # Server port
BASE_URL=http://localhost:3000

# ========== DATABASE ==========
MONGODB_URI=mongodb://localhost:27017/storage-app
MONGODB_TEST_URI=mongodb://localhost:27017/storage-app-test

# ========== SESSION & SECURITY ==========
SESSION_SECRET=<your-session-secret-here>
JWT_SECRET=<your-jwt-secret-here>
SESSION_EXPIRY_DAYS=30        # Session expiry in days
BCRYPT_ROUNDS=10              # Password hashing rounds

# ========== FILE UPLOAD ==========
MAX_FILE_SIZE=104857600       # 100MB in bytes
UPLOAD_DIR=./uploads
TEMP_DIR=./uploads/temp
CHUNK_SIZE=5242880            # 5MB per chunk

# ========== GOOGLE OAUTH ==========
GOOGLE_CLIENT_ID=<your-google-client-id-here>
GOOGLE_CLIENT_SECRET=<your-google-client-secret-here>
GOOGLE_CALLBACK_URL=http://localhost:3000/oauth/google/callback

# ========== GOOGLE DRIVE API ==========
GOOGLE_DRIVE_API_KEY=your_api_key_here
GOOGLE_DRIVE_CALLBACK_URL=http://localhost:3000/oauth/google-drive/callback

# ========== GITHUB OAUTH ==========
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_CALLBACK_URL=http://localhost:3000/oauth/github/callback

# ========== EMAIL SERVICE ==========
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SENDER_EMAIL=noreply@storageapp.com

# ========== CLEANUP JOBS ==========
CLEANUP_INTERVAL=3600000     # Run every 1 hour
TEMP_FILE_RETENTION=86400000 # Keep temp files for 24 hours
TRASH_RETENTION_DAYS=30      # Delete trash after 30 days
```

---

## 🧪 Database Schema & Validation

The database automatically validates schema on startup:

```bash
npm run validate-db
```

This ensures:
- ✅ All required indexes are created
- ✅ Schema validation rules are applied
- ✅ Database version compatibility
- ✅ Collections exist with correct structure

---

## 📊 Monitoring & Logging

### Error Logging
All errors are logged with:
- Timestamp
- Error type & code
- Stack trace
- User context
- Request details

Check server logs:
```bash
npm start 2>&1 | tee server.log
```

### File Operations
All file operations are tracked:
- Upload/download timestamps
- File access logs
- Deletion history
- Move/copy operations

---

## 🔄 Scheduled Jobs

### Cleanup Failed Uploads
- **Frequency:** Every hour (configurable via `CLEANUP_INTERVAL`)
- **Action:** Removes upload sessions older than 24 hours
- **Impact:** Frees disk space from orphaned files

### Cleanup Temp Files
- **Frequency:** Every hour
- **Action:** Removes temporary files not accessed in 24 hours
- **Impact:** Prevents disk bloat

### Trash Cleanup
- **Frequency:** Daily
- **Action:** Permanently deletes trashed items older than 30 days
- **Impact:** Auto-recovery window enforcement

---

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/your-feature`
3. **Commit** changes: `git commit -m 'Add feature description'`
4. **Push** to branch: `git push origin feature/your-feature`
5. **Submit** a Pull Request with description

### Code Standards
- Use **camelCase** for variables/functions
- Use **PascalCase** for classes/models
- Add **JSDoc comments** for functions
- Keep **line length** under 100 characters
- Use **async/await** for async operations
- Include **error handling** in all operations
- Write **meaningful commit messages**

---

## 📚 Project Architecture

### MVC Pattern
- **Models** — MongoDB schemas & validators
- **Views** — JSON API responses
- **Controllers** — Business logic & request handling
- **Routes** — Endpoint definitions & middleware

### Middleware Stack
1. Body/JSON parsing
2. Cookie parsing
3. CORS handling
4. Session validation
5. Upload handling
6. Error catching
7. Error response formatting

### Data Flow
```
Request → Route → Middleware → Controller → Model → Database
         ↓                                          ↓
      Validation                              Query/Update
```

---

## 🐛 Known Limitations

- **File Preview** — Limited to supported formats (MP4, WebM for video; MP3, WAV for audio; JPG, PNG for images)
- **Google Drive Sync** — One-way import only (no real-time sync)
- **ZIP Download** — May timeout for directories with >10,000 files
- **File Size** — Max size configurable but limited by server memory
- **Concurrent Uploads** — Limited by server resources (recommend load balancer for production)
- **Database** — Single MongoDB instance (use replica sets for production)

---

## 📞 Support & Documentation

### Getting Help
- **Issues** — Open GitHub issues for bugs/features
- **Documentation** — See API endpoint docs above
- **Examples** — Check test files in repo
- **Email** — Contact project maintainers

### Related Resources
- [Express.js Documentation](https://expressjs.com)
- [MongoDB Documentation](https://docs.mongodb.com)
- [Google OAuth Documentation](https://developers.google.com/identity)
- [Multer File Upload Guide](https://github.com/expressjs/multer)

---

## 📄 License

This project is licensed under the **ISC License** — See LICENSE.md for details.

---

## 🔖 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history and updates.

---

**Last Updated:** January 27, 2026 | **Version:** 3.0.0 | **Status:** Production Ready ✅

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

**Last Updated:** January 2026 | **Version:** 3.0.0


