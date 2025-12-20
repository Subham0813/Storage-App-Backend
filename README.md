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
- **Downlaod folder in Zip format**

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
| POST   | `/` | Create directory at ````root_folder```` |
| POST   | `/:dirId` | Create sub-directory at ```target_folder``` |
| GET    | `/:id` | Get directory content |
| GET    | `/:id/download` | Download directory content [Zip] |
| PATCH  | `/:id` | Rename directory send in ```req.body``` → ```{newname : "filename"}```|
| PATCH  | `/:id/move` | move directory to a destination, send in ```req.body``` → ```{dirId : "target_folder_id"}```, ```{dirId : ""}``` empty string indicate root folder|
| POST   | `/:id/trash` | Move directory to Bin |
| POST   | `/:id/restore` | Restore directory |
| DELETE   | `/:id/delete` | Delete directory [Tree]|

---

### 📄 Files — `/files`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/` | Upload file with htmlForm to ```root``` folder , fieldname=```file``` |
| POST   | `/:dirId` | Upload file with htmlForm to ```target_folder```, fieldname=```file``` |
| GET    | `/:id/metadata` | file metadata |
| GET    | `/:id/preview?` | Open file , queries → ```type=video&prev=yes``` or ```t=audio&prev=yes``` for forcepreview eligible files|
| GET    | `/:id/download` | Download file |
| PATCH  | `/:id` | Rename file , send in ```req.body``` → ```{newname : "filename"}```|
| PATCH  | `/:id/copy` | copy file to a destination,  send in ```req.body``` → ```{dirId : "target_folder_id"}``` , ```{dirId : ""}``` empty string indicate root folder|
| PATCH  | `/:id/move` | move file to a destination,  send in ```req.body``` → ```{dirId : "target_folder_id"}``` , ```{dirId : ""}``` empty string indicate root folder|
| POST   | `/:id/trash` | Move file to Bin |
| POST   | `/:id/restore` | Restore file |
| DELETE   | `/:id/delete` | Delete file |

---

## 🔐 Auth Routes — `/auth`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/signup` | Register user ```{"fullname": "","email": "","password": ""}```|
| POST   | `/login` | Login & Set cookie ```{"email": "","password": ""}```|
| POST   | `/logout` | Clear cookie |
| DELETE   | `/profile` | Delete all userdata including files, folders|

---


