# Changelog

All notable changes to this project will be documented in this file.

---

## 🚀 v2.0.0 — MongoDB Migration Release (IN DEVELOPMENT)

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
- This release introduces **breaking changes** — old JSON data is no longer supported.
- MongoDB connection is now required to run the backend.
- BackendV2 is nearing stabilization and will be merged into `main` soon.
