# Directory Routes — Request & Response Reference

**Base path:** `/api/directories`  
**Auth required:** ✅ Session cookie (`sessionId`)  
**Mounted after:** `validateSession` middleware  

---

## Access Control

- `checkAccess("dir", "view"|"owner")` middleware — checks ownership, Permission records, or a valid `?token=` for limited view routes.
- `restrictRoot` middleware — blocks operations on the user's root directory. Root cannot be renamed, moved, starred, trashed, shared, or deleted.
- Logged-in access is still required for browsing folder contents and downloading folders by design.

---

## Directory Object Shape

```json
{
  "id": "64f1a2b3c4d5e6f7a8b9c0d2",
  "name": "Documents",
  "size": 10485760,
  "parentId": "64f1a2b3c4d5e6f7a8b9c0d0",
  "path": [
    { "id": "...", "name": "root-user@example.com" }
  ],
  "accessLevel": "private",
  "filesCount": 5,
  "dirsCount": 2,
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

> `filesCount` and `dirsCount` are attached by `checkAccess` middleware — present on all directory responses that go through it.

---

## 1. GET `/api/directories/all-dirs/:id`

Returns all **child directories** directly inside the given directory.

### Request

| Part      | Value                                               |
| --------- | --------------------------------------------------- |
| URL param | `:id` — parent directory ObjectId                   |
| Cookie    | `sessionId` |
| Query     | `?limit=50&cursor=<ObjectId>` (optional pagination) |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "...",
        "name": "Work",
        "size": 5242880,
        "parentId": "...",
        "path": [{ "id": "...", "name": "Documents" }],
        "filesCount": 3,
        "dirsCount": 1,
        "isStarred": false,
        "isDeleted": false,
        "createdAt": "...",
        "updatedAt": "...",
        "owner": {
          "id": "...",
          "name": "John Doe",
          "email": "user@example.com"
        }
      }
    ],
    "nextCursor": null
  }
}
```

---

## 2. GET `/api/directories/all-files/:id`

Returns all **files** directly inside the given directory.

### Request

Same as `all-dirs/:id`.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "...",
        "name": "report.pdf",
        "mime": "application/pdf",
        "size": 204800,
        "extension": "pdf",
        "thumbnailUrl":"https://cdn.yj....",
        "parentId": "...",
        "path": [{ "id": "...", "name": "Documents" }],
        "isStarred": false,
        "isDeleted": false,
        "createdAt": "...",
        "updatedAt": "...",
        "owner": {
          "id": "...",
          "name": "John Doe",
          "email": "user@example.com"
        }
      }
    ],
    "nextCursor": null
  }
}
```

---

## 3. GET `/api/directories/info/:id`

Returns full metadata for a directory including populated path (breadcrumb) and owner info.

### Request

| Part      | Value                                      |
| --------- | ------------------------------------------ |
| URL param | `:id` — directory ObjectId                 |
| Cookie    | `sessionId` |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": { /* full directory object — see shape above */ }
  }
}
```

---

## 4. GET `/api/directories/share-info/:id`

Returns the sharing state of a directory — list of Permission records. **Owner only. Root directory is blocked.**

### Request

| Part      | Value                                               |
| --------- | --------------------------------------------------- |
| URL param | `:id` — directory ObjectId                          |
| Cookie    | `sessionId` (owner only)                            |
| Query     | `?limit=50&cursor=<ObjectId>&public=1` (optional)   |

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
> `id` is the `itemId` (the directory's ObjectId). `onModel` is not included in the response.

---

## 5. GET `/api/directories/download-info/:id`

Returns the name and total recursive size of a directory before downloading.

### Request

| Part      | Value                                      |
| --------- | ------------------------------------------ |
| URL param | `:id` — directory ObjectId                 |
| Cookie    | `sessionId` |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "name": "My Projects",
    "size": 1048576000
  }
}
```

### Error Responses

| Status | Condition           | message                  |
| ------ | ------------------- | ------------------------ |
| 404    | Directory not found | `"Directory not found."` |

---

## 6. GET `/api/directories/download/:id`

Streams the entire directory tree as a ZIP file directly to the client. Max recursion depth is controlled by `MAX_DEPTH` env var (default 5).

### Request

| Part      | Value                                      |
| --------- | ------------------------------------------ |
| URL param | `:id` — directory ObjectId                 |
| Cookie    | `sessionId` |

### Success Response — `200 OK` (binary stream)

```
Content-Type: application/zip
Content-Disposition: attachment; filename="<dirname>-<timestamp>.zip"
```

Response body is a binary ZIP stream. No JSON response.

---

## 7. POST `/api/directories/new`

Creates a new directory under the provided `targetId`. Also accepts `parentId` as an alias for `targetId`.

### Request

```json
// Body (JSON)
{
  "targetId": "64f1a2b3c4d5e6f7a8b9c0d2",
  "name": "Projects"
}
```

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Directory created.",
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d9",
      "name": "Projects",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "path": ["..."],
      "size": 0,
      "isDeleted": false,
      "isStarred": false,
      "filesCount": 0,
      "dirsCount": 0,
      "owner": {
        "id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "John Doe",
        "email": "user@example.com"
      },
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

### Error Responses

| Status | Condition                       | message                                                             |
| ------ | ------------------------------- | ------------------------------------------------------------------- |
| 400    | Validation failed               | validation message                                                  |
| 400    | Directory with same name exists | `"Directory with same name already exists."`                        |
| 403    | Target not owned by user        | `"Unauthorized to write to this directory. Owner access required."` |
| 404    | Target directory not found      | `"Target directory not found."`                                     |

---

## 8. POST `/api/directories/share/:id`

Shares the directory with specific users by email and/or sets a public share link. **Owner only. Root directory is blocked.**

### Request

```json
// Body (JSON)
{
  "emailsWithRole": [
    { "email": "jane@example.com", "role": "view" },
    { "email": "bob@example.com",  "role": "edit" }
  ],
  "publicRole": "view",
  "notify": false,
  "message": "Sharing this folder with you",
  "expiresIn": 7
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

| Status | Condition                       | message                                                                                    |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------ |
| 400    | Validation failed               | validation message                                                                         |
| 400    | No valid share target           | `"No valid share target provided. Provide at least one email or set a public share role."` |
| 403    | Plan doesn't allow public links | `"Your current plan does not support public link sharing. Please upgrade."`                |
| 404    | Directory not found             | `"Item does not exist."`                                                                   |

---

## 9. PATCH `/api/directories/new-token/:id`

Regenerates the public share token for the directory. The old share link becomes invalid. **Owner only. Root directory is blocked.**

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

| Status | Condition           | message             |
| ------ | ------------------- | ------------------- |
| 404    | Directory not found | `"item not found."` |

---

## 10. PATCH `/api/directories/revoke-access/:id`

Revokes permissions for specific users and/or disables the public share link. **Owner only. Root directory is blocked.**

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

> `emails` is an array of plain email strings (not objects). At least one of `emails` or `publicRole` must be provided.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Permissions revoked.",
  "data": {
    "item": { /* updated directory object via getFileDoc */ },
    "revoked": ["jane@example.com"]
  }
}
```

> `revoked` is `null` if no emails were provided.

---

## 11. PATCH `/api/directories/starred/:id`

Toggles the starred state of a directory. **Root directory is blocked.**

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
      "id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "isStarred": true
    }
  }
}
```

---

## 12. PATCH `/api/directories/rename/:id`

Renames a directory. **Owner only. Root directory is blocked.**

### Request

```json
// Body (JSON)
{
  "newname": "Work Projects"
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "Work Projects"
    }
  }
}
```

---

## 13. PATCH `/api/directories/move/:id`

Moves a directory and all its descendants to a different parent. **Owner only. Root directory is blocked.**

### Request

```json
// Body (JSON)
{
  "targetId": "64f1a2b3c4d5e6f7a8b9c0d0"
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item moved to the target directory.",
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d0"
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

## 14. PUT `/api/directories/trash/:id`

Soft-deletes a directory and all its contents recursively. **Owner only. Root directory is blocked.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item moved to bin.",
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d0",
      "isDeleted": true
    }
  }
}
```

---

## 15. PUT `/api/directories/restore/:id`

Restores a directory and its process-deleted contents from the bin. **Owner only. Root directory is blocked.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Item restored.",
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d0",
      "isDeleted": false
    }
  }
}
```

### Error Responses

| Status | Condition                         | message                   |
| ------ | --------------------------------- | ------------------------- |
| 400    | Parent directory is also deleted  | `"Restore parent first."` |
| 404    | Directory not found or not in bin | `"Item not found."`       |

---

## 16. DELETE `/api/directories/delete/:id`

**Permanently** deletes a directory and all its contents from DB and S3/B2. **Irreversible. Owner only. Root directory is blocked.**

### Request

No body. Just `sessionId` cookie and URL param.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Directory permanently deleted and no longer available.",
  "data": {
    "id": "64f1a2b3c4d5e6f7a8b9c0d2"
  }
}
```

### Error Responses

| Status | Condition           | message                  |
| ------ | ------------------- | ------------------------ |
| 400    | Invalid id          | `"Invalid id."`          |
| 404    | Directory not found | `"Directory not found."` |
