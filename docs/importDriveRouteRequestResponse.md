# Import Drive Routes — Request & Response Reference

**Base path:** `/api/import`  
**Auth required:** ✅ All routes require a valid `sessionId` signed cookie  
**Prerequisite:** User must have Google Drive connected via `/api/oauth/google-drive/connect`  

---

## Import Flow Overview

Google Drive import is a **server-side streaming** operation — the backend streams the file from Google Drive directly to S3. The frontend initiates, monitors progress, and finalizes.

```
1. GET  /api/import/google/picker-token
     → returns a valid Google Drive access token for the frontend Google Picker UI

2. User picks a file in the Google Picker UI (frontend)
     → frontend receives file metadata: { id, name, mimeType, sizeBytes }

3. POST /api/import/google/initiate
     → creates import session in Redis
     → returns session id and metadata

4. PUT  /api/import/google/start-import/:id
     → backend starts streaming file from Google Drive to S3 (async, non-blocking)
     → returns 202 immediately

5. GET  /api/import/google/progress/:id   (poll this)
     → returns current import status and progress percentage

6. When status === "can_complete":
   PUT  /api/import/google/complete/:id
     → creates UserFile record in DB
     → returns the new file object
```

---

## Import Session Object

Stored in Redis during the import process.

```json
{
  "id": "<hex string — 24 chars>",
  "userId": "<ObjectId>",
  "targetId": "<directory ObjectId>",
  "path": ["<ObjectId>", "..."],
  "key": "<userId>/<timestamp>.<extension>",
  "name": "presentation.pptx",
  "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "size": 5242880,
  "googleId": "<Google Drive file id>",
  "bytesRead": 2097152,
  "status": "on_progress",
  "expire": 1700000000000
}
```

> `status` values: `"initiated"` | `"on_progress"` | `"can_complete"` | `"completed"` | `"failed"`

---

## 1. GET `/api/import/google/picker-token`

Returns a valid Google Drive OAuth access token for use with the **Google Picker API** in the frontend. Automatically refreshes the token if expired.

### Request

No body. Just `sessionId` cookie.

**Requires:** User must have Google Drive connected (`integrations.googleDrive` must exist with a `refreshToken`).

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "accessToken": "ya29.a0AfH6SMB..."
  }
}
```

### Error Responses

| Status | Condition                  | message                                                        |
| ------ | -------------------------- | -------------------------------------------------------------- |
| 400    | Google Drive not connected | `"Google Drive is not connected."`                             |
| 401    | Drive session expired      | `"Drive session expired. Please re-link your Google account."` |

---

## 2. POST `/api/import/google/initiate`

Creates a new import session in Redis. Validates storage quota and plan file size limit. Does **not** start the actual import yet.

### Request

```json
// Body (JSON)
{
  "file": {
    "id": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
    "name": "presentation.pptx",
    "mimeType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "sizeBytes": "5242880"
  },
  "targetId": "64f1a2b3c4d5e6f7a8b9c0d2"
}
```

| Field           | Type            | Notes                                    |
| --------------- | --------------- | ---------------------------------------- |
| `file.id`       | string          | Google Drive file id                     |
| `file.name`     | string          | 1–255 chars                              |
| `file.mimeType` | string          | valid MIME type                          |
| `file.sizeBytes`| string or number| file size in bytes                       |
| `targetId`      | string          | ObjectId — destination directory         |

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Import initiated.",
  "data": {
    "file": {
      "id": "a1b2c3d4e5f6a1b2c3d4e5f6",
      "userId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "targetId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "path": ["..."],
      "key": "64f1.../1700000000000.pptx",
      "name": "presentation.pptx",
      "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "size": 5242880,
      "googleId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
      "bytesRead": 0,
      "status": "initiated",
      "expire": 1700000000000,
      "sessionAlive": 1700021600000
    }
  }
}
```

> `sessionAlive` is the Redis TTL (6 hrs from now). `expire` is the hard deadline (same as `sessionAlive` on initiation).

### Error Responses

| Status | Condition                  | message                                                                  |
| ------ | -------------------------- | ------------------------------------------------------------------------ |
| 400    | Validation failed          | validation message                                                       |
| 400    | Insufficient storage quota | `"Insufficient storage."`                                                |
| 413    | File exceeds plan limit    | `"File exceeds your plan's maximum single-file size limit of <N>GB."`   |

---

## 3. PUT `/api/import/google/start-import/:id`

Starts the actual file import from Google Drive to S3. **Fire-and-forget** — the backend starts the stream asynchronously and returns `202` immediately. Poll `/progress/:id` to track completion.

### Request

| Part      | Value                                      |
| --------- | ------------------------------------------ |
| URL param | `:id` — import session id from `/initiate` |
| Cookie    | `sessionId`                                |

No body required.

### Success Response — `202 Accepted`

```json
{
  "success": true,
  "message": "Import started."
}
```

> The import is now running in the background. Start polling `/progress/:id`.

### Error Responses

| Status | Condition                    | message                                  |
| ------ | ---------------------------- | ---------------------------------------- |
| 400    | Google Drive not connected   | `"Drive not connected."`                 |
| 404    | Session not found or expired | `"Import session not found or expired."` |
| 409    | Import already started       | `"Import already started or completed."` |
| 410    | Session hard-expired         | `"Import session expired."`              |

---

## 4. GET `/api/import/google/progress/:id`

Returns the current status and progress of an import session. **Poll every 1–2 seconds** after calling `/start-import/:id`.

### Request

| Part      | Value                     |
| --------- | ------------------------- |
| URL param | `:id` — import session id |
| Cookie    | `sessionId`               |

### Success Response — `200 OK` (in progress)

```json
{
  "success": true,
  "message": "Import in progress.",
  "data": {
    "file": {
      "id": "a1b2c3d4e5f6a1b2c3d4e5f6",
      "status": "on_progress",
      "progress": 42,
      "size": 5242880,
      "bytesRead": 2202009
    }
  }
}
```

### Success Response — `200 OK` (ready to complete)

```json
{
  "success": true,
  "message": "Import ready to complete.",
  "data": {
    "file": {
      "id": "a1b2c3d4e5f6a1b2c3d4e5f6",
      "status": "can_complete",
      "progress": 100,
      "bytesRead": 5242880
    }
  }
}
```

> When `status === "can_complete"`, call `/complete/:id` to finalize.

### Success Response — `200 OK` (failed)

```json
{
  "success": true,
  "message": "Import failed.",
  "data": {
    "file": {
      "id": "a1b2c3d4e5f6a1b2c3d4e5f6",
      "status": "failed",
      "progress": 0,
      "bytesRead": 0
    }
  }
}
```

### Error Responses

| Status | Condition                    | message                                    |
| ------ | ---------------------------- | ------------------------------------------ |
| 404    | Session not found or expired | `"Invalid session id or already expired."` |

---

## 5. PUT `/api/import/google/complete/:id`

Finalizes the import. Creates the `UserFile` record in MongoDB and deletes the Redis session.

**Only call when `status === "can_complete"`.**

### Request

| Part      | Value                     |
| --------- | ------------------------- |
| URL param | `:id` — import session id |
| Cookie    | `sessionId`               |

No body required.

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Import completed.",
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d9",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "presentation.pptx",
      "mime": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "size": 5242880,
      "isStarred": false,
      "isDeleted": false,
      "owner": {
        "id": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "John Doe",
        "email": "user@example.com"
      },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

### Error Responses

| Status | Condition                    | message                                    |
| ------ | ---------------------------- | ------------------------------------------ |
| 400    | Import not finished yet      | `"Import not completed yet."`              |
| 404    | Session not found or expired | `"Invalid id or session already expired."` |

---

## Google Docs / Native Files Note

Google Docs, Sheets, Slides, etc. (`application/vnd.google-apps.*`) cannot be downloaded directly — they are exported to an equivalent format (e.g. `.docx`, `.xlsx`, `.pdf`).

If the file is too large to export (Google's 403 export limit), the backend saves it as a **link-only file** with a `webviewLink` pointing to the Google Docs URL. The file will appear in the user's storage but will open in Google Docs when previewed. Its `size` will be `0`.

---

## Frontend Implementation Notes

- **Google Picker UI** — use the `accessToken` from `/picker-token` to initialize the Google Picker. The Picker returns `{ id, name, mimeType, sizeBytes }` for the selected file.
- **Polling** — after `/start-import/:id`, poll `/progress/:id` every 1–2 seconds. Stop polling when `status` is `"can_complete"` or `"failed"`.
- **Session expiry** — `sessionAlive` is the Redis TTL (6 hrs, refreshed on activity). If the session expires mid-import, start over.
- **Drive not connected** — if `/picker-token` returns an error, redirect the user to `/api/oauth/google-drive/connect` to connect their Drive.
