# Changelog

All notable changes to this project will be documented in this file.

---

## 🚀 v3.1.0 — Admin & Sharing Release (2026-02-02)

### ✨ Added
- Admin endpoints for user and resource management (list users, change roles, soft-delete/recover/remove users).
- File & directory sharing: create share links and manage share settings (permissions, expiry).

### 🔁 Changed
- Updated `README.md` and route definitions to document admin and sharing endpoints and their payloads.
- Introduced additional permission checks and validation for admin and sharing flows.

### 🛠️ Fixed
- Fixed minor validation and permission bugs in admin routes and sharing endpoints.

### ❌ Removed
- No breaking removals; features are additive and backwards compatible.

---

## 🚀 v3.0.0 — Enhanced Features & Stability Release

### ✨ Added
- Google Drive integration for file imports and backups
- OAuth 2.0 authentication support with session management
- OTP-based verification for enhanced security
- Advanced upload session management with progress tracking
- Automatic cleanup jobs for failed uploads and temporary files
- MIME type validation and security enforcement
- Enhanced error handling with comprehensive error messages
- File serving with proper content-type detection

### 🔁 Changed
- Improved upload middleware to support streaming and progress events
- Enhanced directory controllers with better parent directory loading
- Refactored session management for improved reliability
- Updated middleware execution order for better security posture
- Optimized database queries for improved performance
- Enhanced validation schemas for stricter data integrity
- Improved logging and debugging capabilities

### 🛠️ Fixed
- Fixed upload session lifecycle management
- Corrected OAuth token refresh flow
- Fixed path traversal security vulnerabilities
- Improved file serving reliability
- Enhanced error propagation through middleware stack
- Fixed concurrent upload handling issues

### ❌ Removed
- Legacy file serving methods
- Deprecated OAuth endpoints

---

## 🚀 v2.0.0 — MongoDB Migration Release

### ✨ Added
- Full MongoDB integration for file and directory storage
- Recursive restore logic with deletedBy rules
- Recursive remove-to-bin feature for directories
- Extension-safe filename rename implementation
- Database validation schema for request/data integrity
- Logging for file uploads and critical operations
- Helper utilities to reduce duplicated logic and improve maintainability

### 🔁 Changed
- Updated CRUD controllers to operate fully on MongoDB collections
- Improved API response structure and field projections
- Refactored controller & middleware structure for cleaner logic flow
- Enhanced filename-handling logic for safer renaming behavior
- Improved general readability and internal code structure
- Reorganized remove/restore logic for consistency and stability

### 🛠️ Fixed
- Fixed logic bugs in directory/file CRUD operations
- Corrected issues in recursive delete and restore flows
- Fixed various minor issues across controllers, utils, and middlewares
- Implemented a global error handler and refactored related error paths
- Removed redundant code and optimized internal functions

### ❌ Removed
- JSON-based DB storage system
- Legacy bin and restore logic

---

## 📌 Notes
- V3.0.0 introduces Google Drive integration and enhanced security features.
- OAuth integration requires proper environment configuration.
- This release maintains backward compatibility with V2.0.0 database schemas.
- V2.0.0 marked the transition from JSON to MongoDB storage.
- MongoDB connection is required to run the backend.
