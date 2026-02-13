# Changelog

All notable changes to this project are documented in this file.

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
- API route style aligned around action-first paths (for example `files/info/:id`, `directories/rename/:id`, `directories/new`).
- Session validation now supports signed-cookie auth and share-token based guest access in one middleware.
- Upload pipeline updated to role-based chunk sizes and explicit session status progression.
- Directory and file controllers expanded for permission-aware share/move/bin/restore operations.
- Environment setup clarified with `.env.example` and removal of hard-coded sensitive placeholders.
- Package version bumped to `3.1.0`.

### Fixed
- Multiple controller/middleware consistency fixes across auth, upload, file, and directory flows.
- Security hygiene improvements around session/cookie handling and configuration defaults.

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
