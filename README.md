# 📦 Storage-App Backend

A backend service for a storage & file management application.  
**Now running on MongoDB (v2 development stage 🚀)**

---

## 🚧 Project Status
- MongoDB integration completed ✔
- Custom cookie-based session auth in use (still no JWT )
- Advanced features still under active development

---

## 🧱 Tech Stack
- **Node.js** + **Express.js**
- **MongoDB** (primary database)
- **Multer** for file uploads

---

## 📂 Main Features
- CRUD files & directories
- **Soft delete (move to Bin) with full restore support**
- **Restore folder structure recursively**

---

## 📁 Directory Structure
- /controllers → Route handlers
- /routes → API route definitions
- /utils → Recursive delete & restore logic
- /uploads → File storage
- app.js → Server entry

---

## 📡 API Overview

### 📁 Directories — `/directories`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/` | Create root directory |
| POST   | `/:dirId` | Create sub-directory |
| GET    | `/:id` | Get directory content |
| PATCH  | `/:id` | Rename directory send in ```req.body``` => ```{newname : "filename"}```|
| POST   | `/:id/trash` | Move directory to Bin |
| POST   | `/:id/restore` | Restore directory |

---

### 📄 Files — `/files`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/:dirId?` | Upload file |
| GET    | `/:id` | Download/Open file |
| PATCH  | `/:id` | Rename file send in ```req.body``` => ```{newname : "filename"}```|
| POST   | `/:id/trash` | Move file to Bin |
| POST   | `/:id/restore` | Restore file |

---

## 🔐 Auth Routes — `/auth`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/signup` | Register user ```{"firstname": "","lastname": "","email": "","password": ""}```|
| POST   | `/login` | Login & Set cookie ```{"email": "","password": ""}```|
| POST   | `/logout` | Clear cookie |
| DELETE   | `/delete` | Delete all userdata|

---


