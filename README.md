# Storage-App-Backend
A backend service for a storage & file-management application.  
**Currently in active development (early stage).**

## 🚧 Project Status
- This backend is still **in building phase**.
- **No database yet** — JSON files are used temporarily for storing user, directory, and file data.
- **Local file storage** for uploads.
- Custom lightweight **token generation + cookie-based sessions** (no JWT/OAuth yet).
- Routes and architecture may change as the project evolves.
- MongoDB + production-grade authentication will be added later.

## 🧱 Tech Stack
- **Node.js**
- **Express.js**
- **Multer** (file uploads)
- **Local JSON files** (temporary database)
- **Cookie-based custom tokens**

## 📁 Directory Structure
- /controllers    -- Logic for each API route
- /routes         -- Route definitions
- /services       -- Core logic for file & directory operations
- /models         -- Stores all .json database files
- /uploads        -- Local uploaded files storage
- app.js          -- Server entry file              

## 📋 Base Routes
Base path: `/auth`

### Auth
- POST      `/signup `
- POST      `/login` 
- POST      `/logout `

### Storage / Bin
- GET       `/:storage ` 
- GET       `/:bin`  

### Delete account
- DELETE    `/delete`


## 📋 API Routes
Base paths: `/directories` & `/files`

### Read
- GET      ` /:id ` 

### Create
- POST      `/`  
- POST      `/:dirId`  

### Update
- PATCH    ` /:id ` 

### Trash (Soft Delete & restore)
- POST      `/:id/trash`  
- POST      `/:id/restore`   

## 🚀 Getting Started
```bash
git clone https://github.com/Subham0813/Storage-App-Backend.git
cd Storage-App-Backend
npm install
npm start
```

# 📌 Next Steps
- Db integration (MongoDb/PostgreSql) [ongoing]

