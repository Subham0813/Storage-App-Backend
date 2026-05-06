# User Routes — Request & Response Reference

**Base path:** `/api/user`
**Auth required:** ✅ All routes require a valid `sessionId` signed cookie
**Mounted after:** `validateSession` middleware — `req.user` is always populated

---

## User Object Shape

This is the `user` object returned by `/info` and set in session. Frontend should treat this as the source of truth for the logged-in user. calculate `usedeQuota` using {`maxQuota` - `root.size`} 

```json
{
  "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "name": "John Doe",
  "email": "user@example.com",
  "avatar": "",
  "role": "user",                      // "super_admin" | "admin" | "manager" | "user"
  "tier": "free",                      // "free" | "lite" | "plus" | "pro" | "super"
  "root": {                            // user's root directory
    "_id": "64f1a2b3c4d5e6f7a8b9c0d2", 
    "size": 643763
  }, 
  "authProviders": ["email"],          // ["email", "google", "github"]
  "deviceCount": 1,                    // number of active sessions
  "maxQuota": 1073741824,              // bytes — 1 GB default
  "isLogged": true,
  "theme": "Light",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

---

## 1. GET `/api/user/info`

Returns the currently authenticated user's profile.

### Request

No body. No query params. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "user": { /* user object — see shape above */ }
  }
}
```

---

## 2. PUT `/api/user/logout`

Logs out the current session only. Decrements `deviceCount` by 1 and deletes the current session from Redis.

### Request

No body. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Logout Successful."
}
```

**Side effect:** Clears `sessionId` cookie.

---

## 3. PUT `/api/user/logout-all`

Logs out from **all devices**. Sets `deviceCount` to 0 and deletes all sessions from Redis.

### Request

No body. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Logout Successful from all devices."
}
```

**Side effect:** Clears `sessionId` cookie.

---

## 4. DELETE `/api/user/delete-profile`

Permanently deletes the authenticated user's account, all their files (from S3), and all their directories from the database. This is **irreversible**.

### Request

No body. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Account deleted successfully."
}
```

**Side effect:** Clears `sessionId` cookie.

---

## 5. DELETE `/api/user/revoke-drive-integration`

Removes the Google Drive integration from the user's account. After this, Drive import/backup will no longer work until reconnected.

> **Note:** This endpoint sets `integrations.googleDrive` to an empty object `{}`. It does **not** revoke the OAuth token on Google's sidefor now only, the mechanism will update later on.

### Request

No body. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Drive integration deleted."
}
```

### Error Responses

| Status | Condition                                | message                    |
| ------ | ---------------------------------------- | -------------------------- |
| 404    | Integration not found or already removed | `"Integration not found."` |

---

## 6. GET `/api/user/link-google`

Links a Google account to the currently authenticated user. This is a **redirect** — same as `/api/oauth/google/connect` but called while logged in.

**How to call:** Browser navigation (not fetch)
```
window.location.href = "http://localhost:4000/api/user/link-google"
```

**Middleware:** `checkAuthProviderStatus("google")` — blocks if Google is already linked.

**Response:** `302 Redirect` → Google authorization URL

---

## 7. GET `/api/user/link-github`

Links a GitHub account to the currently authenticated user.

**How to call:** Browser navigation (not fetch)
```
window.location.href = "http://localhost:4000/api/user/link-github"
```

**Middleware:** `checkAuthProviderStatus("github")` — blocks if GitHub is already linked.

**Response:** `302 Redirect` → GitHub authorization URL

---

## Paginated List Endpoints

All list endpoints below share the same **cursor-based pagination** pattern:

### Query Params (all list endpoints)

| Param    | Type            | Default | Max | Description                                 |
| -------- | --------------- | ------- | --- | ------------------------------------------- |
| `limit`  | number          | 50      | 100 | Items per page                              |
| `cursor` | ObjectId string | —       | —   | Last `_id` from previous page for next page |

### Paginated Response Shape

```json
{
  "success": true,
  "data": {
    "items": [ /* array of file or directory objects */ ],
    "nextCursor": "<ObjectId string> or null"   // null means no more pages
  }
}
```

> When `nextCursor` is `null`, the frontend has reached the last page.

---

## 8. GET `/api/user/bin/files`

Returns files the user has moved to the bin (soft-deleted by user).

### File object in bin

```json
{
  "_id": "...",
  "name": "report.pdf",
  "mime": "application/pdf",
  "size": 204800,
  "parentId": "...",
  "userId": "...",
  "isDeleted": true,
  "isStarred": false,
  "deletedAt": "2026-01-10T00:00:00.000Z",
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## 9. GET `/api/user/bin/dirs`

Returns directories the user has moved to the bin.

### Directory object in bin

```json
{
  "_id": "...",
  "name": "Old Projects",
  "size": 1048576,
  "parentId": "...",
  "userId": "...",
  "isDeleted": true,
  "isStarred": false,
  "deletedAt": "2026-01-10T00:00:00.000Z",
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## 10. GET `/api/user/recents/files`

Returns recently updated files (not deleted, not root).

### Additional Query Param

| Param  | Type   | Default | Description                |
| ------ | ------ | ------- | -------------------------- |
| `days` | number | 7       | How many days back to look |

> **Note:** `days` is read from `req.query.days` — pass an integer string (e.g. `?days=3`).

---

## 11. GET `/api/user/recents/dirs`

Returns recently updated directories (not deleted, not root).

Same `days` query param as above. Root directory is excluded from results.

---

## 12. GET `/api/user/starred/files`

Returns files the user has starred.

### File object in starred list

```json
{
  "_id": "...",
  "name": "important.pdf",
  "mime": "application/pdf",
  "size": 204800,
  "parentId": "...",
  "userId": "...",
  "isDeleted": false,
  "isStarred": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## 13. GET `/api/user/starred/dirs`

Returns directories the user has starred. Same shape as starred files but for directories.

---

## 14. GET `/api/user/shared/files`

Returns files that the authenticated user has **shared with others** (files where the user granted permissions to other users).

---

## 15. GET `/api/user/shared/dirs`

Returns directories that the authenticated user has **shared with others**.

---

## 16. GET `/api/user/shared-with/files`

Returns files that **other users have shared with** the authenticated user (files where the user has a Permission record).

---

## 17. GET `/api/user/shared-with/dirs`

Returns directories that **other users have shared with** the authenticated user.

---

## Error Responses (all routes)

| Status | Condition                                | message                               |
| ------ | ---------------------------------------- | ------------------------------------- |
| 401    | No `sessionId` cookie or session expired | `"Unauthorized. Please login again."` |
| 403    | Session invalid                          | `"Unauthorized: validation failed."`  |
| 400    | Invalid `cursor` query param             | `"Invalid cursor."`                   |
