# File Routes — Request & Response Reference

**Base path:** `/api/files`  
**Auth required:** ✅ Session cookie (`sessionId`)  
**Mounted after:** `validateSession` middleware  

---

## Access Control

Most routes use the `checkAccess("file", "view"|"owner")` middleware which:
- Checks if the user owns the file (`"owner"`), OR
- Checks if the user has a `Permission` record for the file (`"view"`), OR
- Checks if the file has `publicRole = "view"` and a valid `?token=` query param (guest access on view routes only)

Routes that modify data require `"owner"` level access. Read-only routes require `"view"` level.

**Guest access** (public share link): Append `?token=<shareToken>` to the URL. No `sessionId` cookie needed. Only works on `view`-level routes.

---

## File Object Shape

This is the full file object returned by `/info/:id`. Other endpoints return a subset.

```json
{
  "id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "name": "report.pdf",
  "mime": "application/pdf",
  "size": 204800,
  "extension": "pdf",
  "thumbnailUrl": "https://cdn.example.com/thumbnails/...",
  "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
  "path": [
    { "id": "...", "name": "Documents" },
    { "id": "...", "name": "Work" }
  ],
  "accessLevel": "private",
  "owner": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d1",
    "name": "John Doe",
    "email": "user@example.com"
  },
  "isStarred": false,
  "isDeleted": false,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

## 1. GET `/api/files/info/:id`

Returns full metadata for a file.

### Request

| Part      | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| URL param | `:id` — file ObjectId                                              |
| Cookie    | `sessionId` (or query `?token=<shareToken>` for guest file access) |

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

| Status | Condition                 | message             |
| ------ | ------------------------- | ------------------- |
| 403    | No access                 | `"Unauthorized."`   |
| 404    | File not found or deleted | `"Item not found."` |

---

## 2. GET `/api/files/preview/:id`

Returns a short-lived signed CDN/object-storage URL for **inline preview** of the file (e.g. open in browser tab). Tracks bandwidth consumption.

### Request

| Part      | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| URL param | `:id` — file ObjectId                                              |
| Cookie    | `sessionId` (or query `?token=<shareToken>` for guest file access) |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "url": "https://cloudflare-cdn.com/stream?token=eyJVc2VySWQiOi..."
  }
}
```

### Error Responses

| Status | Condition                 | message                                                 |
| ------ | ------------------------- | ------------------------------------------------------- |
| 403    | Bandwidth limit exceeded  | `"Bandwidth limit exceeded. Please upgrade your plan."` |
| 404    | File not found or deleted | `"File not found."`                                     |

---

## 3. GET `/api/files/download/:id`

Returns a short-lived signed CDN/object-storage URL for **downloading** the file (forces browser download). Tracks bandwidth consumption.

### Request

Same as `/preview/:id`.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "url": "https://cloudflare-cdn.com/download?token=eyJVc2VySWQiOi..."
  }
}
```

### Error Responses

| Status | Condition                 | message                                                 |
| ------ | ------------------------- | ------------------------------------------------------- |
| 403    | Bandwidth limit exceeded  | `"Bandwidth limit exceeded. Please upgrade your plan."` |
| 404    | File not found or deleted | `"File not found."`                                     |

---

## 4. GET `/api/files/share-info/:id`

Returns the current sharing state of a file — list of Permission records for the file. **Owner only.**

### Request

| Part      | Value                                                    |
| --------- | -------------------------------------------------------- |
| URL param | `:id` — file ObjectId                                    |
| Cookie    | `sessionId` (owner only, no guest access)                |
| Query     | `?limit=50&cursor=<ObjectId>&public=1` (optional)        |

> Pass `?public=1` to include the `publicPermission` object in the response. Without it, `publicPermission` is returned as an empty object `{}`.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "permissions": [
      {
        "id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "userId": { "id": "...", "name": "Jane", "email": "jane@example.com" },
        "grantedBy": { "id": "...", "name": "John Doe", "email": "user@example.com" },
        "permission": "view"
      }
    ],
    "nextCursor": null,
    "publicPermission": {
      "token": "aB3xZ9qR...",
      "permission": "view",
      "sharedAt": "2026-01-01T00:00:00.000Z",
      "expiresAt": "2026-02-01T00:00:00.000Z"
    }
  }
}
```

> `publicPermission` is only populated when `?public=1` is passed. If the item is not public, `publicPermission` will be `{ "permission": "none" }`.  
> `id` is the `itemId` (the file's ObjectId). `onModel` is not included in the response.

---

## 5. POST `/api/files/copy/:id`

Creates a virtual copy of the file in the target directory. The copy shares the same S3/B2 key (no duplicate storage). **Owner only.**

### Request

| Part      | Value                        |
| --------- | ---------------------------- |
| URL param | `:id` — source file ObjectId |
| Cookie    | `sessionId` (owner only)     |

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
      "id": "64f1a2b3c4d5e6f7a8b9c0d9",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "Copy of report.pdf",
      "extension": "pdf",
      "mime": "application/pdf",
      "size": 204800,
      "isStarred": false,
      "isDeleted": false,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z",
      "owner": {
        "id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "John Doe",
        "email": "user@example.com"
      }
    }
  }
}
```

### Error Responses

| Status | Condition                  | message                         |
| ------ | -------------------------- | ------------------------------- |
| 400    | Insufficient storage quota | `"Insufficient storage quota."` |
| 404    | Source file not found      | `"Original file not found."`    |

---

## 6. POST `/api/files/share/:id`

Shares the file with specific users by email and/or sets a public share link. **Owner only.**

### Request

| Part      | Value                    |
| --------- | ------------------------ |
| URL param | `:id` — file ObjectId    |
| Cookie    | `sessionId` (owner only) |

```json
// Body (JSON)
{
  "emailsWithRole": [
    { "email": "jane@example.com", "role": "view" },
    { "email": "bob@example.com",  "role": "edit" }
  ],
  "publicRole": "view",
  "notify": false,
  "message": "Here are the files",
  "expiresIn": 1296000000
}
```

| Field            | Type                     | Required | Notes                                    |
| ---------------- | ------------------------ | -------- | ---------------------------------------- |
| `emailsWithRole` | array of `{email, role}` | yes      | min 1, max 100. `role`: `"view"\|"edit"` |
| `publicRole`     | `"view"`                 | optional | sets a public share link                 |
| `notify`         | boolean                  | optional | send email notifications                 |
| `message`        | string                   | optional | max 500 chars                            |
| `expiresIn`      | number                   | optional | expiry duration in ms from now           |

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item shared successfully.",
  "data": {
    "id": "...",
    "name": "...",
    "accessLevel": "public",
    "sharedTo": ["user@example.com"],
    "publicRole": "view",
    "token": "YSmns8296......"
  }
}
```

> `sharedTo` is `null` when only `publicRole` was set and no valid emails were provided.

### Error Responses

| Status | Condition                       | message                                                                                    |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| 400    | Validation failed               | e.g. `"Invalid email."`                                                                    |
| 400    | No valid share target           | `"No valid share target provided. Provide at least one email or set a public share role."` |
| 403    | Plan doesn't allow public links | `"Your current plan does not support public link sharing. Please upgrade."`                |
| 404    | File not found or not owner     | `"Item does not exist."`                                                                   |

---

## 7. PATCH `/api/files/rename/:id`

Renames a file. **Owner only.**

### Request

```json
// Body (JSON)
{
  "newname": "final-report.pdf"
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "final-report.pdf"
    }
  }
}
```

### Error Responses

| Status | Condition      | message             |
| ------ | -------------- | ------------------- |
| 400    | Invalid name   | validation message  |
| 404    | File not found | `"Item not found."` |

---

## 8. PATCH `/api/files/move/:id`

Moves a file to a different directory. **Owner only.**

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
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2"
    }
  }
}
```

### Error Responses

| Status | Condition                        | message                                                  |
| ------ | -------------------------------- | -------------------------------------------------------- |
| 403    | Target is a child of the item    | `"Item can not be moved to child."`                      |
| 409    | Item already in target directory | `"Item already exists in the target."`                   |
| 400    | Insufficient quota               | `"Can not perform operation due to insufficient quota."` |

---

## 9. PATCH `/api/files/starred/:id`

Toggles the starred state of a file.

### Request

```json
// Body (JSON)
{
  "starred": true
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Properties changed.",
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "isStarred": true
    }
  }
}
```

### Error Responses

| Status | Condition                          | message                                            |
| ------ | ---------------------------------- | -------------------------------------------------- |
| 400    | Invalid payload                    | `"Invalid payload."`                               |
| 400    | Already in requested starred state | `"Item not found or already starred/non-starred."` |

---

## 10. PATCH `/api/files/new-token/:id`

Regenerates the public share token for the file. The old share link becomes invalid. **Owner only.**

### Request

```json
// Body (JSON) — all fields optional
{
  "expiresIn": 1296000000  // number (ms) — new expiry from now. Pass null to clear expiry. Omit to leave unchanged.
}
```

### Success Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "newToken": "aB3xZ9qR..."
  }
}
```

### Error Responses

| Status | Condition      | message             |
| ------ | -------------- | ------------------- |
| 404    | File not found | `"item not found."` |

---

## 11. PATCH `/api/files/revoke-access/:id`

Revokes permissions for specific users and/or disables the public share link. **Owner only.**

### Request

```json
// Body (JSON)
{
  "emails": ["jane@example.com", "bob@example.com"],
  "publicRole": "none",
  "notify": false,
  "message": "Access has been revoked."
}
```

| Field        | Type             | Required | Notes                                |
| ------------ | ---------------- | -------- | ------------------------------------ |
| `emails`     | array of strings | no       | plain email strings, min 1, max 100  |
| `publicRole` | `"none"`         | no       | pass `"none"` to disable public link |
| `notify`     | boolean          | no       | send email notifications             |
| `message`    | string           | no       | max 500 chars                        |

> At least one of `emails` or `publicRole` must be provided.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Permissions revoked.",
  "data": {
    "item": { /* updated file object via getFileDoc */ },
    "revoked": ["jane@example.com"]
  }
}
```

> `revoked` is `null` if no emails were provided.

---

## 12. PUT `/api/files/trash/:id`

Moves a file to the bin (soft delete). Recoverable until the trash retention period defined by the user's plan. **Owner only.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item moved to bin.",
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "isDeleted": true
    }
  }
}
```

---

## 13. PUT `/api/files/restore/:id`

Restores a file from the bin back to its original parent directory. **Owner only.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item restored.",
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "isDeleted": false
    }
  }
}
```

### Error Responses

| Status | Condition                        | message                   |
| ------ | -------------------------------- | ------------------------- |
| 400    | Parent directory is also deleted | `"Restore parent first."` |
| 404    | File not found or not in bin     | `"Item not found."`       |

---

## 14. DELETE `/api/files/delete/:id`

**Permanently** deletes a file. The physical file is also deleted from S3/B2 if no other virtual copies share the same key. **Irreversible. Owner only.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "File permanently deleted and no longer available.",
  "data": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d2"
  }
}
```

### Error Responses

| Status | Condition      | message                                |
| ------ | -------------- | -------------------------------------- |
| 400    | Invalid id     | `"Invalid id."`                        |
| 404    | File not found | `"File not found or already deleted."` |

---

## 15. POST `/api/files/webhook`

Cloudflare CDN bandwidth webhook. Called by the Cloudflare worker after serving a file — reports bytes served back to the backend to track bandwidth consumption per user. **Not a client-facing route.**

**Auth:** HMAC-verified via `x-cf-webhook-auth` header (shared secret, not session cookie).

### Request

```
Header: x-cf-webhook-auth: <CLOUDFLARE_WEBHOOK_SECRET>
```

```json
// Body (JSON)
{
  "token": "<base64-encoded HMAC-signed payload>",
  "bytesSent": 204800
}
```

| Field      | Type   | Notes                                                                 |
| ---------- | ------ | --------------------------------------------------------------------- |
| `token`    | string | Base64 string: `base64(payloadJson + "\|" + hmac_sha256(payloadJson))` |
| `bytesSent`| number | Bytes served by Cloudflare for this request                           |

### Success Responses

| Status | Condition                              | Body (plain text)    |
| ------ | -------------------------------------- | -------------------- |
| 200    | Bandwidth logged successfully          | `"Bandwidth Logged"` |
| 200    | `token` missing, `bytesSent` is 0/NaN  | `"Ignored"`          |

### Error Responses

| Status | Condition                                    | Body (JSON)                              |
| ------ | -------------------------------------------- | ---------------------------------------- |
| 400    | HMAC signature mismatch (token tampered)     | `{ "error": "Token Tampering Detected" }` |
| 403    | `x-cf-webhook-auth` header missing or wrong  | `{ "error": "Unauthorized Edge Request" }` |
| 500    | Unexpected server error                      | `"Webhook Error"` (plain text)           |
