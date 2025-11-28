# Changelog

All notable changes to this project will be documented in this file.

---

## 🚀 v2.0.0 — MongoDB Migration Release (IN DEVELOPMENT)

### ✨ Added
- Full MongoDB integration for file and directory storage
- Recursive restore logic with deletedBy rules
- Recursive remove to bin feature for directories
- Extension-safe filename rename implementation

### 🔁 Changed
- Updated CRUD controllers to operate on MongoDB collections
- Improved API response structure and field projections

### ❌ Removed
- JSON-based DB storage system
- Legacy bin and restore logic

---

## 📌 Note
#### This version introduces **breaking changes** — old JSON data is not supported anymore.
#### MongoDB connection is now required to run the backend.
