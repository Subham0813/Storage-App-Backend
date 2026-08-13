# User Routes — Request & Response Reference

**Base path:** `/api/user`  
**Auth required:** ✅ All routes require a valid `sessionId` signed cookie  
**Mounted after:** `validateSession` middleware — `req.user` is always populated  

---

## User Object Shape

This is the `user` object returned by `/info`. Frontend should treat this as the source of truth for the logged-in user.

```json
{
  "id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "name": "John Doe",
  "email": "user@example.com",
  "avatarUrl":"https://cdn.storage-app.dev/avatar/...",
  "role": "user",
  "rootId": "64f1a2b3c4d5e6f7a8b9c0d2",
  "usedQuota": 643763,
  "authProviders": "email",
  "maxQuota": 50000000000,
  "maxBandwidthQuota": 100000000000,
  "usedBandwidthQuota": 0,
  "plan": "PRO_MONTHLY", 
  "subscription": {
    "plan": "PRO",
    "billingCycle": "MONTHLY",
    "status": "active",
    "subscriptionStartedAt": "2026-06-01T00:00:00.000Z",
    "subscriptionRenewAt": "2026-07-01T00:00:00.000Z",
    "subscriptionEndsAt": null,
    "subscriptionExpiresAt": null
  },
  "limits": {
    "quotaBytes": 50000000000,
    "maxFileSize": 2000000000,
    "chunkSize": 8388608,
    "monthlyBandwidthLimit": 100000000000,
    "maxUploadConcurrency": 4,
    "maxDevices": 3,
    "canCreatePublicLinks": true,
    "trashRetentionDays": 15,
    "gracePeriod": 15
  },
  "integrations": "googleDrive",
  "isLogged": true,
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

> `subscription` is an empty object `{}` when the user is on the FREE plan.  
> `authProviders` is a `&`-joined string. Supported providers: `"email"` and `"google"` only.  
> `integrations` is a `&`-joined string of connected integration keys, e.g. `"googleDrive"`.  
> `limits` is always present — reflects the active plan's limits from `PLAN_DETAILS`. Field is named `limits` (not `limit`).  
> `plan` is the full plan key e.g. `"PRO_MONTHLY"`, `"FREE"`, `"ELITE_YEARLY"`. The `subscription.plan` is just the base e.g. `"PRO"`.

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

## 2. GET `/api/user/stats`

Returns the user's storage usage breakdown by file type.

### Request

No body. No query params. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "maxQuota":1000000000,
    "usedQuota":9265338,
    "totalSize": 10485760,
    "totalFiles": 42,
    "totalDirs": 8,
    "breakdown": {
      "docs":   { "count": 10, "size": 2097152 },
      "images": { "count": 20, "size": 5242880 },
      "videos": { "count": 5,  "size": 3145728 },
      "others": { "count": 7,  "size": 0 }
    }
  }
}
```

> `totalSize` includes files in the bin (trashed files still consume quota).

---

## 3. PATCH `/api/user/update-name`

Updates the authenticated user's display name.

### Request

```json
// Body (JSON)
{
  "name": "Jane Doe"   // string, 3–100 chars, letters and single spaces only
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Name updated successfully.",
  "data": {
    "user": {
      "name": "Jane Doe"
    }
  }
}
```

---

## 4. GET `/api/user/usage`

Returns the user's storage and bandwidth usage.

### Request

No body. No query params. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "usage": {
      "maxQuota": 5000000000,
      "usedQuota": 643763,
      "maxBandwidthQuota": 10000000000,
      "usedBandwidthQuota": 0
    }
  }
}
```

---

## 4. PUT `/api/user/update-avatar`

Updates the authenticated user's avatar image.

### Request

```json
// Body (JSON)
{
  "avatarBase64": "data:image/webp;base64,..."
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Avatar updated successfully.",
  "data": {
    "user": {
      "avatarUrl": "https://cdn.storage-app.dev/avatar/..."
    }
  }
}
```

### Error Responses

| Status | Condition               | message                           |
| ------ | ----------------------- | --------------------------------- |
| 400    | Invalid image payload   | validation message                |
| 413    | Thumbnail size exceeded | `"Thumbnail size exceeds limit."` |
| 500    | Avatar upload failed    | `"Avatar upload failed."`         |

---

## 5. PUT `/api/user/logout`

Logs out the current session only. Deletes the current session from Redis.

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

## 6. PUT `/api/user/logout-all`

Logs out from **all devices**. Deletes all sessions from Redis.

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

## 7. PUT `/api/user/revoke-drive-integration`

Removes the Google Drive integration from the user's account (clears stored tokens).

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

| Status | Condition             | message                    |
| ------ | --------------------- | -------------------------- |
| 404    | Integration not found | `"Integration not found."` |

---

## 8. DELETE `/api/user/delete-profile`

Permanently deletes the authenticated user's account, all their files (from S3/B2), and all their directories. **Irreversible.**

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

## 9. GET `/api/user/invoice`

Returns the current subscription invoice URL.

### Request

No body. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "url": "https://rzp.io/i/..."
  }
}
```

### Error Responses

| Status | Condition              | message                                        |
| ------ | ---------------------- | ---------------------------------------------- |
| 404    | No active subscription | `"User does not have an active subscription."` |
| 404    | Invoice not found      | `"Invoice not found"`                          |

---

## 10. GET `/api/user/link-google`

Links a Google account to the currently authenticated user. Browser navigation only.

**How to call:** Browser navigation (not fetch)
```
window.location.href = "http://localhost:4000/api/user/link-google"
```

**Middleware:** `checkAuthProviderStatus("google")` — returns `409` if Google is already linked.

**Response:** `302 Redirect` → Google authorization URL

### Error Response — `409 Conflict`

```json
{
  "success": false,
  "message": "Already connected with google"
}
```

---

## 11. GET `/api/user/link-github`

Links a GitHub account to the currently authenticated user. Browser navigation only.

**How to call:** Browser navigation (not fetch)
```
window.location.href = "http://localhost:4000/api/user/link-github"
```

**Middleware:** `checkAuthProviderStatus("github")` — returns `409` if GitHub is already linked.

**Response:** `302 Redirect` → GitHub authorization URL

### Error Response — `409 Conflict`

```json
{
  "success": false,
  "message": "Already connected with github"
}
```

> Note: `"github"` is not in the `authProviders` schema enum (`["email", "google"]`). The route exists but GitHub linking does not persist to `authProviders`.

---

## Paginated List Endpoints

All list endpoints below share the same **cursor-based pagination** pattern.

### Query Params (all list endpoints)

| Param    | Type            | Default | Description                                 |
| -------- | --------------- | ------- | ------------------------------------------- |
| `limit`  | number          | 50      | Items per page (max 50)                     |
| `cursor` | ObjectId string | —       | Last `_id` from previous page for next page |
| `days`   | number          | 7       | Only for `/recents/*` — lookback window     |

### Paginated Response Shape

```json
{
  "success": true,
  "data": {
    "items": [ /* array of file or directory objects */ ],
    "nextCursor": "<ObjectId string> or null"
  }
}
```

---

## 12. GET `/api/user/bin/files`

Returns files the user has moved to the bin (soft-deleted, `deletedBy: "user"`).

---

## 13. GET `/api/user/bin/dirs`

Returns directories the user has moved to the bin.

---

## 14. GET `/api/user/recents/files`

Returns recently updated files (within `days` days, not deleted, not root).

---

## 15. GET `/api/user/recents/dirs`

Returns recently updated directories (within `days` days, not deleted, not root).

---

## 16. GET `/api/user/starred/files`

Returns files the user has starred (`isStarred: true`, not deleted).

---

## 17. GET `/api/user/starred/dirs`

Returns directories the user has starred.

---

## 18. GET `/api/user/shared-by-me/files`

Returns files that the authenticated user has **shared with others** (either via Permission records or public link).

---

## 19. GET `/api/user/shared-by-me/dirs`

Returns directories that the authenticated user has **shared with others**.

---

## 20. GET `/api/user/shared-with-me/files`

Returns files that **other users have shared with** the authenticated user (via Permission records).

---

## 21. GET `/api/user/shared-with-me/dirs`

Returns directories that **other users have shared with** the authenticated user.

---

## 22. GET `/api/user/search/files`

Searches files by name for the authenticated user. Case-insensitive substring match.

### Request

| Query Param | Type            | Default | Description                                   |
| ----------- | --------------- | ------- | --------------------------------------------- |
| `q`         | string          | —       | Search query (required, min 1 char)          |
| `limit`     | number          | 50      | Items per page (max 100)                     |
| `cursor`    | ObjectId string | —       | Last `_id` from previous page for next page  |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "report.pdf",
        "size": 2400000,
        "mime": "application/pdf",
        "extension": ".pdf",
        "owner": { "id": "...", "name": "John Doe", "email": "user@example.com" },
        "path": [{ "id": "...", "name": "Projects" }],
        "type": "file"
      }
    ],
    "nextCursor": "64f1a2b3c4d5e6f7a8b9c0d2"
  }
}
```

> Results are sorted by `_id` ascending. The response shape matches all other list endpoints with `getFileDoc()` applied (sensitive fields stripped).

### Error Responses

| Status | Condition              | message                         |
| ------ | ---------------------- | ------------------------------- |
| 400    | Missing `q`            | `"Search query is required."`   |
| 400    | Invalid `cursor`       | `"Invalid cursor."`             |
| 400    | Invalid model param    | `"No \`model\` param found."`   |

---

## 23. GET `/api/user/search/dirs`

Searches directories by name for the authenticated user. Same shape and behavior as `GET /api/user/search/files` but returns directories instead.

---

## 24. PUT `/api/user/empty-trash`

Permanently deletes **all** trashed files and directories for the authenticated user. This is a bulk operation — it removes file records, directory records, associated Permission records, updates ancestor sizes, and deletes orphaned S3 objects.

> Files may remain in S3 if other users still hold a virtual copy referencing the same S3 key.

### Request

No body. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Trash emptied successfully."
}
```

### Success Response (when already empty) — `200 OK`

```json
{
  "success": true,
  "message": "Trash is already empty."
}
```

### Error Responses

| Status | Condition | message |
| ------ | --------- | ------- |
| 500    | Transaction failure | Server error |

---

## 25. POST `/api/user/feedback`

Submits a bug report or user feedback. Supports an optional base64-encoded screenshot.

### Request

```json
// Body (JSON)
{
  "category": "upload",
  "title": "Cannot upload file",
  "description": "When I click upload, it says error.",
  "screenshotBase64": "data:image/webp;base64,..."
}
```

| Field              | Type   | Required | Notes                                                                                   |
| ------------------ | ------ | -------- | --------------------------------------------------------------------------------------- |
| `category`         | string | yes      | `"upload" \| "preview" \| "sharing" \| "billing" \| "performance" \| "other"`           |
| `title`            | string | yes      | 5–200 chars                                                                             |
| `description`      | string | yes      | 10–2000 chars                                                                           |
| `screenshotBase64` | string | no       | Base64 image data. Must be ≤ 1MB (when decoded). Uploaded as webp to public bucket.     |

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Bug report submitted successfully."
}
```

### Error Responses

| Status | Condition                  | message                                        |
| ------ | -------------------------- | ---------------------------------------------- |
| 400    | Validation failed          | e.g., `"Title must be at least 5 characters."` |
| 400    | Screenshot > 1MB           | `"Screenshot must be less than 1MB."`          |
