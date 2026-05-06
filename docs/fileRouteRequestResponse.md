# File Routes — Request & Response Reference

**Base path:** `/api/files`
**Auth required:** ✅ Session cookie (`sessionId`) OR public share token (`?token=<shareToken>`)
**Mounted after:** `validateSession` middleware

---

## Access Control

Most routes use the `checkAccess("file", "view"|"edit")` middleware which:
- Checks if the user owns the file, OR
- Checks if the user has a `Permission` record for the file, OR
- Checks if the file has `publicRole.role = "view"` and a valid `?token=` query param (guest access)

Routes that modify data require `"edit"` level access. Read-only routes require `"view"` level.

**Guest access** (public share link): Append `?token=<shareToken>` to the URL. No `sessionId` cookie needed. Only works on `view`-level routes.

---

## File Object Shape

This is the full file object returned by `/info/:id`. Other endpoints return a subset.

```json
{
  "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "name": "report.pdf",
  "mime": "application/pdf",
  "size": 204800,                          // bytes
  "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
  "ancestors": [                           // populated — for breadcrumb
    { "_id": "...", "name": "Documents" },
    { "_id": "...", "name": "Work" }
  ],
  "publicRole": "none",                    // "view" | "none" — flattened from publicRole.role
  "owner": {                               // populated from userId
    "name": "John Doe",
    "email": "user@example.com"
  },
  "isStarred": false,
  "isDeleted": false,
  "webViewLink": "",                       // Google Drive web view link (if imported)
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

## 1. GET `/api/files/info/:id`

Returns full metadata for a file.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — file ObjectId |
| Cookie | `sessionId` OR query `?token=<shareToken>` |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": { /* full file object — see shape above */ }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 403 | No access | `"Unauthorized."` |
| 404 | File not found or deleted | `"Item not found."` |

---

## 2. GET `/api/files/preview/:id`

Returns a short-lived (5 min) pre-signed S3 URL for **inline preview** of the file (e.g. open in browser tab).

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — file ObjectId |
| Cookie | `sessionId` OR query `?token=<shareToken>` |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "url": "https://s3.amazonaws.com/bucket/key?X-Amz-Signature=...&X-Amz-Expires=300"
  }
}
```

> The `url` has `Content-Disposition: inline` — open it in a new tab or `<iframe>` for preview.
> URL expires in **300 seconds (5 min)**. Do not cache it.

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 403 | No access | `"Unauthorized."` |
| 404 | File not found | `"File not found."` |

---

## 3. GET `/api/files/download/:id`

Returns a short-lived (5 min) pre-signed S3 URL for **downloading** the file (forces browser download).

### Request

Same as `/preview/:id`.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "url": "https://s3.amazonaws.com/bucket/key?X-Amz-Signature=...&X-Amz-Expires=300"
  }
}
```

> The `url` has `Content-Disposition: attachment` — use it as an `<a href>` with `download` attribute or trigger `window.location.href`.
> URL expires in **300 seconds (5 min)**.

---

## 4. GET `/api/files/share-info/:id`

Returns the current sharing state of a file — list of users with permissions and the public link role. **Owner only.**

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — file ObjectId |
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
      "role": "view",          // "view" | "none"
      "sharedAt": "2026-01-01T00:00:00.000Z",
      "shareToken": "abc123xyz"
    },
    "nextCursor": null
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 403 | Not the owner or guest token used | `"Unauthorized."` |
| 404 | File not found | `"Item not found."` |

---

## 5. POST `/api/files/copy/:id`

Creates a copy of the file in the target directory. The copy shares the same S3 key (no duplicate storage).

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — source file ObjectId |
| Cookie | `sessionId` |

```json
// Body (JSON)
{
  "targetId": "64f1a2b3c4d5e6f7a8b9c0d2"  // ObjectId — destination directory
}
```

### Success Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d9",   // new file's id
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "Copy of report.pdf",
      "mime": "application/pdf",
      "size": 204800
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Insufficient storage quota | `"Insufficient storage quota."` |
| 403 | No edit access | `"Unauthorized."` |
| 404 | Source file not found | `"Original file not found."` |

---

## 6. POST `/api/files/share/:id`

Shares the file with specific users by email and/or sets a public share link.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — file ObjectId |
| Cookie | `sessionId` (owner only) |

```json
// Body (JSON)
{
  "emailsWithRole": [                    // required — min 1, max 100
    { "email": "jane@example.com", "role": "view" },
    { "email": "bob@example.com",  "role": "edit" }
  ],
  "publicRole": "view",                  // optional — "view" only; omit to not change public link
  "notify": false,                       // optional boolean
  "message": "Here are the files"        // optional string, max 500 chars
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item shared successfully."
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Validation failed | e.g. `"Role must be either 'view' or 'edit'"` |
| 404 | File not found or not owner | `"Directory does not exist or you do not have permission."` |

---

## 7. PATCH `/api/files/rename/:id`

Renames a file.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — file ObjectId |
| Cookie | `sessionId` |

```json
// Body (JSON)
{
  "newname": "final-report.pdf"   // 1–100 chars, no special chars: \ / : * ? " < > |
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "final-report.pdf"
    }
  }
}
```

---

## 8. PATCH `/api/files/move/:id`

Moves a file to a different directory.

### Request

```json
// Body (JSON)
{
  "targetId": "64f1a2b3c4d5e6f7a8b9c0d2"  // ObjectId — destination directory
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item moved to the target directory.",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2"
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Insufficient quota | `"Can not perform operation due to insufficient quota."` |
| 409 | File already in target | `"Item already exists in the target."` |

---

## 9. PATCH `/api/files/starred/:id`

Toggles the starred state of a file.

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
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "isStarred": true
    }
  }
}
```

---

## 10. PATCH `/api/files/new-token/:id`

Regenerates the public share token for the file. The old share link becomes invalid.

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "newToken": "aB3xZ9qR..."
    }
  }
}
```

---

## 11. PATCH `/api/files/revoke-access/:id`

Revokes permissions for specific users and/or disables the public share link.

### Request

```json
// Body (JSON)
{
  "emails": ["jane@example.com"],   // optional — array of emails to revoke
  "publicRole": "none"              // optional — "none" to disable public link
}
```

> At least one of `emails` or `publicRole` must be provided.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Permissions revoked."
}
```

---

## 12. PUT `/api/files/trash/:id`

Moves a file to the bin (soft delete). File is recoverable for 15 days.

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item moved to bin.",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "isDeleted": true
    }
  }
}
```

---

## 13. PUT `/api/files/restore/:id`

Restores a file from the bin back to its original parent directory.

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item restored.",
  "data": {
    "item": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "isDeleted": false
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Parent directory is also deleted | `"Restore parent first."` |
| 404 | File not in bin | `"Item not found."` |

---

## 14. DELETE `/api/files/delete/:id`

**Permanently** deletes a file. The physical file is also deleted from S3. **Irreversible.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "File permanently deleted."
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 403 | No edit access | `"Unauthorized."` |
| 404 | File not found | `"File not found or already deleted."` |

---

## Common Error Responses (all routes)

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid ObjectId in URL | `"Invalid id."` |
| 401 | No session | `"Unauthorized. Please login again."` |
| 403 | Insufficient permissions | `"Unauthorized."` |
