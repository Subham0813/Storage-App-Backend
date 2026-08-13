# Admin Routes — Request & Response Reference

**Base path:** `/api/admin`  
**Auth required:** ✅ Session cookie (`sessionId`) — user must have role `admin` or `super_admin`  
**Access control:** Enforced by `validateSession` middleware — non-admin roles get `403` before reaching any handler  

---

## Role Hierarchy

```
super_admin  →  can operate on all users (admin, user)
admin        →  can operate on users with lower roles only (user)
user         →  no admin access
```

> A user cannot perform admin actions on themselves or on users with equal/higher roles.

---

## User Object Shape (Admin View)

Admin endpoints return the same shape as `getUserPayload()` (same as `/api/user/info`) plus a `sessionCount` field added by `getAllUsers`.

```json
{
  "id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "name": "John Doe",
  "email": "user@example.com",
  "avatarUrl": "https://cdn.storage-app.dev/avatar/...",
  "role": "user",
  "rootId": "64f1a2b3c4d5e6f7a8b9c0d2",
  "usedQuota": 643763,
  "authProviders": "email",
  "maxQuota": 5000000000,
  "maxBandwidthQuota": 10000000000,
  "usedBandwidthQuota": 0,
  "plan": "FREE",
  "subscription": {},
  "limits": {
    "quotaBytes": 5000000000,
    "maxFileSize": 100000000,
    "chunkSize": 5242880,
    "monthlyBandwidthLimit": 10000000000,
    "maxUploadConcurrency": 2,
    "maxDevices": 1,
    "canCreatePublicLinks": false,
    "trashRetentionDays": 7,
    "gracePeriod": 7
  },
  "integrations": "",
  "isLogged": true,
  "isDeleted": false,
  "sessionCount": 1,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

> `googleId`, `githubId`, `password`, `root`, `integrations` (raw), and `_id` are always excluded.  
> `authProviders` is a `&`-joined string, e.g. `"email&google"`.  
> `subscription` is `{}` for FREE users, or the full subscription object for paid users.  
> `limits` is always present — reflects the active plan's limits.  
> `sessionCount` is only present on the list endpoint (`GET /users`), not on `GET /user/:id`.

---

## 1. GET `/api/admin/dashboard`

Returns aggregate statistics for the admin dashboard overview.

### Request

No body. No query params. Just the `sessionId` cookie (admin/super_admin).

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "totalUsers": 1234,
    "activeUsers": 892,
    "storageUsedBytes": 2100000000000,
    "mrrRupees": 84000,
    "planBreakdown": [
      { "plan": "FREE", "count": 802, "percentage": 65 },
      { "plan": "PRO", "count": 271, "percentage": 22 },
      { "plan": "ULTRA", "count": 99, "percentage": 8 },
      { "plan": "PREMIUM", "count": 42, "percentage": 3 },
      { "plan": "ELITE", "count": 20, "percentage": 2 }
    ],
    "recentUsers": [
      { "id": "64f1...", "name": "John Doe", "email": "user@example.com", "plan": "FREE", "createdAt": "2026-01-12T..." }
    ]
  }
}
```

> `mrrRupees` is the estimated Monthly Recurring Revenue in Indian Rupees. Yearly plan prices are divided by 12 for this calculation.  
> `planBreakdown` percentages are rounded to the nearest integer.  
> `recentUsers` contains the 5 most recently registered non-deleted users.

### Error Responses

| Status | Condition | message |
| ------ | --------- | ------- |
| 403    | Not admin | `"Forbidden"` |

---

## 2. GET `/api/admin/users`

Returns a paginated list of users. Supports filtering by deleted status.

### Request

| Query Param | Type            | Default | Description                                   |
| ----------- | --------------- | ------- | --------------------------------------------- |
| `limit`     | number          | 50      | Items per page (max 100)                      |
| `cursor`    | ObjectId string | —       | Last `_id` from previous page (for next page) |
| `isDeleted` | boolean string  | `false` | `"true"` to list soft-deleted/banned users    |

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Users found.",
  "data": {
    "users": [
      { /* user object — see shape above */ }
    ],
    "nextCursor": "64f1a2b3c4d5e6f7a8b9c0d1"
  }
}
```

> Results are sorted by `_id` descending (newest first). Cursor pagination uses `$lt`.  
> `role` will be `"banned"` instead of the user's actual role when `isDeleted: true`.

### Error Responses

| Status | Condition                 | message             |
| ------ | ------------------------- | ------------------- |
| 400    | Invalid `cursor`          | `"Invalid cursor."` |
| 400    | Invalid `isDeleted` value | `"Invalid query."`  |
| 403    | Not admin                 | `"Forbidden"`       |

---

## 3. GET `/api/admin/user/:id`

Returns a single user by their MongoDB ObjectId.

### Request

| Part      | Value                           |
| --------- | ------------------------------- |
| URL param | `:id` — user ObjectId           |
| Cookie    | `sessionId` (admin/super_admin) |

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "User found.",
  "data": {
    "user": { /* full user object — see shape above */ }
  }
}
```

### Error Responses

| Status | Condition        | message             |
| ------ | ---------------- | ------------------- |
| 400    | Invalid ObjectId | `"Invalid id."`     |
| 400    | User not found   | `"User not found."` |

---

## 4. GET `/api/admin/storage/:id`

Returns detailed storage usage breakdown for a specific user.

### Request

| Part      | Value                           |
| --------- | ------------------------------- |
| URL param | `:id` — user ObjectId           |
| Cookie    | `sessionId` (admin/super_admin) |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "maxQuota": 5000000000,
    "usedQuota": 643763,
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
> `maxQuota` and `usedQuota` are taken from the target user's document, not the admin's.

### Error Responses

| Status | Condition        | message              |
| ------ | ---------------- | -------------------- |
| 400    | Invalid ObjectId | `"Invalid user id."` |
| 403    | Not admin        | `"Forbidden."`       |

---

## 5. PATCH `/api/admin/change-role/:id`

Changes a user's role. `super_admin` can promote/demote anyone. `admin` can only change `user` roles.

### Request

| Part      | Value                           |
| --------- | ------------------------------- |
| URL param | `:id` — target user ObjectId    |
| Cookie    | `sessionId` (admin/super_admin) |

```json
// Body (JSON) — or query param ?role=
{
  "role": "admin"   // "user" | "admin"
}
```

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "User role changed.",
  "data": {
    "user": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "role": "admin"
    }
  }
}
```

### Error Responses

| Status | Condition                    | message                             |
| ------ | ---------------------------- | ----------------------------------- |
| 400    | Invalid role value           | `"Invalid role."`                   |
| 400    | Invalid id or self-operation | `"Invalid id."`                     |
| 409    | Target has equal/higher role | `"You don't have this permission."` |

---

## 6. PATCH `/api/admin/logout-user/:id`

Force-logs out a user by deleting all their Redis sessions.

### Request

| Part      | Value                           |
| --------- | ------------------------------- |
| URL param | `:id` — target user ObjectId    |
| Cookie    | `sessionId` (admin/super_admin) |

No body required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "User logged out and all the user sessions are deleted.",
  "data": {
    "user": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "isLogged": false
    }
  }
}
```

### Error Responses

| Status | Condition                    | message                             |
| ------ | ---------------------------- | ----------------------------------- |
| 400    | Invalid id or self-operation | `"Invalid id."`                     |
| 400    | Cannot logout yourself       | `"You cannot logout yourself."`     |
| 404    | User not found               | `"User not found."`                 |
| 409    | Target has equal/higher role | `"You don't have this permission."` |

---

## 7. PATCH `/api/admin/remove-user/:id`

Soft-deletes (bans) a user. Sets `isDeleted: true`, `isLogged: false`, and clears all Redis sessions. The user can be recovered later.

### Request

| Part      | Value                           |
| --------- | ------------------------------- |
| URL param | `:id` — target user ObjectId    |
| Cookie    | `sessionId` (admin/super_admin) |

```json
// Body (JSON)
{
  "reason": "Violated terms of service."   // string, min 10 chars — required
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "User banned.",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "isDeleted": true
    }
  }
}
```

### Error Responses

| Status | Condition                         | message                                         |
| ------ | --------------------------------- | ----------------------------------------------- |
| 400    | `reason` missing or too short     | `"Reason must be at least 10 characters long."` |
| 400    | Invalid id or self-operation      | `"Invalid id."`                                 |
| 400    | Cannot remove yourself            | `"You cannot remove yourself."`                 |
| 404    | User not found or already deleted | `"User not found."`                             |
| 409    | Target is `super_admin`           | `"You don't have this permission."`             |

---

## 8. PATCH `/api/admin/recover-user/:id`

Recovers a soft-deleted (banned) user. **`super_admin` only.**

### Request

| Part      | Value                          |
| --------- | ------------------------------ |
| URL param | `:id` — target user ObjectId   |
| Cookie    | `sessionId` (super_admin only) |

No body required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "User recovered.",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "isDeleted": false
    }
  }
}
```

### Error Responses

| Status | Condition                     | message                             |
| ------ | ----------------------------- | ----------------------------------- |
| 400    | Invalid id or self-operation  | `"Invalid id."`                     |
| 404    | User not found or not deleted | `"User not found."`                 |
| 409    | Caller is not `super_admin`   | `"You don't have this permission."` |

---

## 9. DELETE `/api/admin/delete-user/:id`

**Permanently** deletes a user and all their data (files from S3, directories, file records). **`super_admin` only. Irreversible.**

### Request

| Part      | Value                          |
| --------- | ------------------------------ |
| URL param | `:id` — target user ObjectId   |
| Cookie    | `sessionId` (super_admin only) |

No body required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "User deleted permanently and no longer available.",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1"
    }
  }
}
```

### Error Responses

| Status | Condition                    | message                             |
| ------ | ---------------------------- | ----------------------------------- |
| 400    | Invalid id or self-operation | `"Invalid id."`                     |
| 404    | User not found               | `"User not found."`                 |
| 409    | Caller is not `super_admin`  | `"You don't have this permission."` |

---

## Permission Matrix

| Action                  | admin | super_admin |
| ----------------------- | ----- | ----------- |
| View dashboard stats    | ✅     | ✅           |
| List all users          | ✅     | ✅           |
| Get single user         | ✅     | ✅           |
| Get storage info        | ✅     | ✅           |
| Change role (user)      | ✅     | ✅           |
| Change role (admin)     | ❌     | ✅           |
| Logout user             | ✅     | ✅           |
| Logout admin            | ❌     | ✅           |
| Ban (remove) user       | ✅     | ✅           |
| Ban admin               | ❌     | ✅           |
| Recover banned user     | ❌     | ✅           |
| Permanently delete user | ❌     | ✅           |

---

## Common Error Responses (all routes)

| Status | Condition                | message                               |
| ------ | ------------------------ | ------------------------------------- |
| 401    | No session               | `"Unauthorized. Please login again."` |
| 403    | Not admin or super_admin | `"Forbidden"`                         |
