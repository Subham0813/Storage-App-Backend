# Directory Routes — Request & Response Reference

**Base path:** `/api/directories`
**Auth required:** ✅ Session cookie (`sessionId`) OR public share token (`?token=<shareToken>`)
**Mounted after:** `validateSession` middleware

---

## Access Control

- `checkAccess("dir", "view"|"edit")` middleware — same as file routes, checks ownership, Permission records, or public share token.
- `restrictRoot` middleware — blocks operations on the user's root directory (the top-level folder). Root cannot be renamed, moved, starred, trashed, shared, or deleted.
- Guest access via `?token=<shareToken>` works only on `view`-level routes.

---

## Directory Object Shape

```json
{
  "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
  "name": "Documents",
  "size": 10485760,                        // bytes — total size of all contents
  "parentId": "64f1a2b3c4d5e6f7a8b9c0d0",
  "ancestors": [                           // populated on info endpoint
    { "_id": "...", "name": "root-user@example.com", "..." , "..." } //for breadcrumbs/path
  ],
  "userId": "64f1a2b3c4d5e6f7a8b9c0d1",
  "isStarred": false,
  "isDeleted": false,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

## 1. GET `/api/directories/all-dirs/:id`

Returns all **child directories** directly inside the given directory. Used to render folder contents.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — parent directory ObjectId |
| Cookie | `sessionId` OR query `?token=<shareToken>` |
| Query | `?limit=50&cursor=<ObjectId>` (optional pagination) |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "_id": "...",
        "name": "Work",
        "size": 5242880,
        "parentId": "...",
        "ancestors": ["..."],
        "userId": "...",
        "isStarred": false,
        "isDeleted": false,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "nextCursor": null   // null = no more pages
  }
}
```

> `publicRole` and `deletedBy`/`deletedAt` are excluded from this list.

---

## 2. GET `/api/directories/all-files/:id`

Returns all **files** directly inside the given directory.

### Request

Same as `all-dirs/:id` — URL param `:id`, optional pagination, `sessionId` or `?token`.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "_id": "...",
        "name": "report.pdf",
        "mime": "application/pdf",
        "size": 204800,
        "parentId": "...",
        "ancestors": ["..."],
        "userId": "...",
        "isStarred": false,
        "isDeleted": false,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "nextCursor": null
  }
}
```

> `key`, `webViewLink`, `publicRole`, `deletedBy`, `deletedAt` are excluded.

---

## 3. GET `/api/directories/info/:id`

Returns full metadata for a directory including populated ancestors (breadcrumb path) and owner info.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — directory ObjectId |
| Cookie | `sessionId` OR query `?token=<shareToken>` |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": {
      "_id": "...",
      "name": "Documents",
      "size": 10485760,
      "parentId": "...",                   // null if root
      "ancestors": [
        { "_id": "...", "name": "root-user@example.com" }
      ],
      "publicRole": "none",                // "view" | "none" — flattened
      "owner": {
        "name": "John Doe",
        "email": "user@example.com"
      },
      "isStarred": false,
      "isDeleted": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

---

## 4. GET `/api/directories/share-info/:id`

Returns the sharing state of a directory — list of users with permissions and the public link role. **Owner only. Root directory is blocked.**

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — directory ObjectId |
| Cookie | `sessionId` (owner only, no guest access) |
| Query | `?limit=50&cursor=<ObjectId>` (optional pagination) |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "userId": { "_id": "...", "name": "Jane", "email": "jane@example.com" },
        "permission": "view"   // "view" | "edit"
      }
    ],
    "publicRole": {
      "role": "view",
      "sharedAt": "2026-01-01T00:00:00.000Z",
      "shareToken": "abc123xyz"
    },
    "nextCursor": null
  }
}
```

---

## 5. POST `/api/directories/new`

Creates a new directory inside a target parent directory.

### Request

| Part | Value |
|------|-------|
| Cookie | `sessionId` |

```json
// Body (JSON)
{
  "targetId": "64f1a2b3c4d5e6f7a8b9c0d2",  // ObjectId — parent directory
  "name": "New Folder"                        // optional, 1–100 chars, no special chars: \ / : * ? " < > |
                                              // defaults to "Untitled Folder" if omitted
}
```

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Directory created.",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d9",
      "name": "New Folder",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "userId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "ancestors": [
        { "_id": "...", "name": "root-user@example.com" }
      ],
      "isDeleted": false,
      "isStarred": false,
      "updatedAt": "...",
      "createdAt": "...",
    }
  }
}
```

---

## 6. POST `/api/directories/share/:id`

Shares a directory with specific users by email and/or sets a public share link. **Root directory is blocked.**

### Request

```json
// Body (JSON)
{
  "emailsWithRole": [
    { "email": "jane@example.com", "role": "view" },
    { "email": "bob@example.com",  "role": "edit" }
  ],
  "publicRole": "view",    // optional — "view" only
  "notify": false,
  "message": "Sharing this folder with you"
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item shared successfully."
}
```

---

## 7. PATCH `/api/directories/rename/:id`

Renames a directory. **Root directory is blocked.**

### Request

```json
// Body (JSON)
{
  "newname": "My Documents"   // 1–100 chars, no special chars
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "My Documents"
    }
  }
}
```

---

## 8. PATCH `/api/directories/move/:id`

Moves a directory to a different parent directory. **Root directory is blocked.**

### Request

```json
// Body (JSON)
{
  "targetId": "64f1a2b3c4d5e6f7a8b9c0d5"  // ObjectId — destination directory
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item moved to the target directory.",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d5"
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Insufficient quota | `"Can not perform operation due to insufficient quota."` |
| 403 | Target is a child of the item being moved | `"Item can not be moved to child."` |
| 409 | Already in target | `"Item already exists in the target."` |

---

## 9. PATCH `/api/directories/starred/:id`

Toggles the starred state of a directory. **Root directory is blocked.**

### Request

```json
// Body (JSON)
{
  "starred": true   // boolean
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Properties changed.",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "isStarred": true
    }
  }
}
```

---

## 10. PATCH `/api/directories/new-token/:id`

Regenerates the public share token for the directory. Old share link becomes invalid. **Root directory is blocked.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "item": { 
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "newToken": "aB3xZ9qR..."
    }
  }
}
```

---

## 11. PATCH `/api/directories/revoke-access/:id`

Revokes permissions for specific users and/or disables the public share link. **Root directory is blocked.**

### Request

```json
// Body (JSON)
{
  "emails": ["jane@example.com"],   // optional
  "publicRole": "none"              // optional — "none" to disable public link
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Permissions revoked."
}
```

---

## 12. PUT `/api/directories/trash/:id`

Moves a directory and all its contents to the bin (soft delete). **Root directory is blocked.** Recoverable for 15 days.

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item moved to bin.",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d0",
      "isDeleted": true
    }
  }
}
```

---

## 13. PUT `/api/directories/restore/:id`

Restores a directory from the bin. Also restores all descendant files and directories. **Root directory is blocked.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item restored.",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d0",
      "isDeleted": false
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Parent directory is also deleted | `"Restore parent first."` |
| 404 | Directory not in bin | `"Item not found."` |

---

## 14. DELETE `/api/directories/delete/:id`

**Permanently** deletes a directory and all its contents (files + subdirectories). Also deletes S3 objects if no other user has copies. **Root directory is blocked. Irreversible.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Directory permanently deleted and no longer available.",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d2"
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 403 | Root directory operation attempted | blocked by `restrictRoot` |
| 404 | Directory not found | `"Directory not found."` |

---

## Common Error Responses (all routes)

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid ObjectId in URL | `"Invalid id."` |
| 401 | No session | `"Unauthorized. Please login again."` |
| 403 | Insufficient permissions or root operation | `"Unauthorized."` |
