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
> Note: The `manager` role exists in the schema enum but is not enforced in any controller logic — treat it as equivalent to `user` for access control purposes.

---

## User Object Shape (Admin View)

Admin endpoints return a fuller user object than the regular `/api/user/info` endpoint.

```json
{
  "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "name": "John Doe",
  "email": "user@example.com",
  "avatar": "",
  "role": "user",                        // "super_admin" | "admin" | "manager" | "user"
  "tier": "free",                        // "free" | "lite" | "plus" | "pro" | "super"
  "root": "64f1a2b3c4d5e6f7a8b9c0d2",
  "authProviders": ["email"],
  "deviceCount": 1,
  "maxQuota": 1073741824,
  "isLogged": true,
  "isDeleted": false,
  "theme": "Light",
  "integrations": { /* googleDrive, github, etc. */ },
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

> `googleId`, `githubId`, and `password` are always excluded from admin responses.

---

## 1. GET `/api/admin/users`

Returns a paginated list of users. Supports filtering by deleted status.

### Request

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| `limit` | number | 50 | Items per page (max 100) |
| `cursor` | ObjectId string | — | Last `_id` from previous page (for next page) |
| `isDeleted` | boolean | `false` | `true` to list soft-deleted/banned users |

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Users found.",
  "data": {
    "users": [
      { /* user object — see shape above */ }
    ],
    "nextCursor": "64f1a2b3c4d5e6f7a8b9c0d1"   // null if no more pages
  }
}
```

> Results are sorted by `_id` descending (newest first). Cursor pagination uses `$lt` (not `$gt`).

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid `cursor` | `"Invalid cursor."` |
| 400 | Invalid `isDeleted` value | `"Invalid query."` |
| 403 | Not admin | `"Unauthorized"` |

---

## 2. GET `/api/admin/user/:id`

Returns a single user by their MongoDB ObjectId.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — user ObjectId |
| Cookie | `sessionId` (admin/super_admin) |

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

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid ObjectId | `"Invalid id."` |
| 400 | User not found | `"User not found."` |

---

## 3. PATCH `/api/admin/change-role/:id`

Changes a user's role. `super_admin` can promote/demote anyone. `admin` can only change `user` roles.

> The allowed values for `role` are `"user"` and `"admin"` only — `"manager"` is not a valid target via this endpoint.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — target user ObjectId |
| Cookie | `sessionId` (admin/super_admin) |

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
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "role": "admin"
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid role value | `"Invalid role."` |
| 400 | Invalid id or self-operation | `"Invalid id."` |
| 409 | Target has equal/higher role | `"You don't have this permission."` |

---

## 4. PATCH `/api/admin/logout-user/:id`

Force-logs out a user by deleting all their Redis sessions. `super_admin` can logout anyone. `admin` can only logout users with a lower role.

> **Note:** This endpoint deletes Redis session keys but does **not** update `isLogged` or `deviceCount` on the User document — only the DB `isLogged` field is checked to confirm the user is currently logged in.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — target user ObjectId |
| Cookie | `sessionId` (admin/super_admin) |

No body required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "User logged out. Session deleted.",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "role": "user"
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid id or self-operation | `"Invalid id."` |
| 404 | User not found or not logged in | `"User not found."` |
| 409 | Target has equal/higher role | `"You don't have this permission."` |

---

## 5. PATCH `/api/admin/remove-user/:id`

Soft-deletes (bans) a user. Sets `isDeleted: true`, `isLogged: false`, `deviceCount: 0`, and clears all Redis sessions. The user can be recovered later. `super_admin` can remove anyone. `admin` can only remove users with a lower role.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — target user ObjectId |
| Cookie | `sessionId` (admin/super_admin) |

No body required.

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

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid id or self-operation | `"Invalid id."` |
| 404 | User not found or already deleted | `"User not found."` |
| 409 | Target is `super_admin` | `"You don't have this permission."` |

---

## 6. PATCH `/api/admin/recover-user/:id`

Recovers a soft-deleted (banned) user. Sets `isDeleted: false`. **`super_admin` only.**

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — target user ObjectId |
| Cookie | `sessionId` (super_admin only) |

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

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid id or self-operation | `"Invalid id."` |
| 404 | User not found or not deleted | `"User not found."` |
| 409 | Caller is not `super_admin` | `"You don't have this permission."` |

---

## 7. DELETE `/api/admin/delete-user/:id`

**Permanently** deletes a user and all their data (files from S3, directories, file records). **`super_admin` only. Irreversible.**

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — target user ObjectId |
| Cookie | `sessionId` (super_admin only) |

No body required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Userdata deleted permanently and no longer available.",
  "data": {
    "user": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d1"
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid id or self-operation | `"Invalid id."` |
| 404 | User not found | `"User not found."` |
| 409 | Caller is not `super_admin` | `"You don't have this permission."` |

---

## Permission Matrix

| Action | admin | super_admin |
|--------|-------|-------------|
| List all users | ✅ | ✅ |
| Get single user | ✅ | ✅ |
| Change role (user) | ✅ | ✅ |
| Change role (admin) | ❌ | ✅ |
| Logout user | ✅ | ✅ |
| Logout admin | ❌ | ✅ |
| Ban (remove) user | ✅ | ✅ |
| Ban admin | ❌ | ✅ |
| Recover banned user | ❌ | ✅ |
| Permanently delete user | ❌ | ✅ |

---

## Common Error Responses (all routes)

| Status | Condition | message |
|--------|-----------|---------|
| 401 | No session | `"Unauthorized. Please login again."` |
| 403 | Not admin or super_admin | `"Unauthorized"` |
