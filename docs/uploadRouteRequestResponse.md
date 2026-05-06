# Upload Routes — Request & Response Reference

**Base path:** `/api/uploads`
**Auth required:** ✅ All routes require a valid `sessionId` signed cookie
**Upload mechanism:** S3 Multipart Upload via pre-signed URLs (client uploads directly to S3)

---

## Upload Flow Overview

This is a **client-driven multipart upload** — the backend never receives the file bytes. The client uploads each part directly to S3 using pre-signed PUT URLs.

```
1. POST   /api/uploads/initiate
     → creates upload session in Redis
     → returns S3 uploadId + first batch of pre-signed PUT URLs

2. Client PUTs each file chunk directly to S3 using the pre-signed URLs
     → S3 returns an ETag for each uploaded part

3. PUT    /api/uploads/save/:id
     → client sends { ETagsWithPartNumbers } to acknowledge uploaded parts
     → backend tracks progress in Redis

4. (If more parts remain)
   GET    /api/uploads/remaining-urls/:id   → get next batch of pre-signed URLs
   GET    /api/uploads/part-url/:id         → get a single pre-signed URL for a specific part

5. PUT    /api/uploads/complete/:id
     → backend calls S3 CompleteMultipartUpload
     → creates UserFile record in DB
     → returns the new file object

6. (On failure/cancel)
   DELETE /api/uploads/cancel/:id
     → aborts S3 multipart upload
     → deletes Redis session
```

---

## Upload Session Object

This is what's stored in Redis and partially returned to the client.

```json
{
  "id": "<S3 uploadId>",
  "userId": "<ObjectId>",
  "targetId": "<directory ObjectId>",
  "ancestors": ["<ObjectId>", "..."],
  "key": "<userId>/<userId>_<timestamp>.<ext>",
  "name": "report.pdf",
  "mime": "application/pdf",
  "size": 10485760,
  "partSize": 5242880,
  "lastPartSize": 5242880,
  "totalParts": 2,
  "uploadedParts": [
    { "partNumber": 1, "ETag": "\"abc123\"" }
  ],
  "expire": 1700000000000,   // Unix ms — session hard expiry (2 days)
  "status": "initiated"      // "initiated" | "on_progress" | "can_complete"
}
```

---

## 1. POST `/api/uploads/initiate`

Creates a new upload session. Validates file size against user's storage quota. Returns the S3 `uploadId` and the first batch of pre-signed PUT URLs (up to 10 parts).

### Request

```json
// Body (JSON)
{
  "file": {
    "name": "report.pdf",          // string, 1–100 chars, no special chars: \ / : * ? " < > |
    "size": 10485760,              // number (bytes), must be positive
    "mime": "application/pdf"      // valid MIME type string
  },
  "targetId": "64f1a2b3c4d5e6f7a8b9c0d2"  // ObjectId — destination directory
}
```

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Upload initiated.",
  "data": {
    "session": {
      "id": "abc123XYZ...",                  // S3 multipart uploadId — use as :id in all subsequent calls
      "userId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "report.pdf",
      "mime": "application/pdf",
      "size": 10485760,
      "status": "initiated",
      "totalParts": 2,                       // total number of parts to upload
      "partSize": 4485760,
      "urls": [                              // first batch of pre-signed PUT URLs (max 10)
        {
          "partNumber": 1,
          "contentLength" : 125875
          "url": "https://s3.amazonaws.com/bucket/key?partNumber=1&uploadId=...&X-Amz-Signature=..."
        },
        {
          "partNumber": 2,
          "contentLength" : 125875
          "url": "https://s3.amazonaws.com/bucket/key?partNumber=2&uploadId=...&X-Amz-Signature=..."
        }
      ],
      "requestType": "PUT",                  // always "PUT" — use PUT method when uploading to S3
      "sessionAlive": 1700000000000,         // Unix ms — Redis session expiry (200 min from now)
      "expire": 1700000000000                // Unix ms — hard expiry (2 days)
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Validation failed | e.g. `"Invalid mimetype"` |
| 400 | Insufficient storage quota | `"Insufficient storage."` |

---

## 2. PUT `/api/uploads/save/:id`

Acknowledges uploaded parts by sending their ETags. Backend stores them in Redis to track progress.

**Call this after each batch of parts is uploaded to S3.**

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — S3 uploadId from `/initiate` |

```json
// Body (JSON)
{
  "ETagsWithPartNumbers": [
    { "partNumber": 1, "ETag": "\"d8e8fca2dc0f896fd7cb4cb0031ba249\"" },
    { "partNumber": 2, "ETag": "\"b026324c6904b2a9cb4b88d6d61c81d1\"" }
  ]
}
```

> ETags are returned by S3 in the response headers of each PUT request. They include the surrounding quotes — keep them as-is.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Parts acknowledged.",
  "data": {
    "session": {
      "id": "abc123XYZ...",
      "status": "on_progress",    // "on_progress" | "can_complete" (when all parts done)
      "progress": 50,             // 0–100 integer
      "sessionAlive": 1700000000000,
      "expire": 1700000000000
    }
  }
}
```

> When `status` is `"can_complete"`, all parts are uploaded — call `/complete/:id` next.

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Missing or empty `ETagsWithPartNumbers` | `"ETags with part numbers are required."` |
| 400 | All parts already acknowledged | `"Upload ready to completed."` |

> **Note:** The message `"Upload ready to completed."` is a known typo in the codebase — it means the upload is ready to be completed.
| 400 | Invalid or duplicate parts | `"Invalid or already acknowledged parts."` |
| 404 | Session not found or expired | `"Invalid session id or already expired."` |
| 404 | Session expired (hard expiry) | `"Upload session expired."` |

---

## 3. PUT `/api/uploads/complete/:id`

Finalizes the upload. Calls S3 `CompleteMultipartUpload`, then creates the `UserFile` record in MongoDB.

**Only call when `status === "can_complete"`.**

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — S3 uploadId |
| Cookie | `sessionId` |

No body required.

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "File uploaded.",
  "data": {
    "file": {
      "_id": "64f1a2b3c4d5e6f7a8b9c0d9",
      "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "name": "report.pdf",
      "mime": "application/pdf",
      "size": 10485760,
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Not all parts uploaded yet | `"All parts must be uploaded first."` |
| 404 | Session not found | `"Invalid session id or already expired."` |
| 410 | Session hard-expired | `"Upload session expired."` |
| 500 | S3 multipart completion failed | `"Failed to complete multipart upload."` |

---

## 4. DELETE `/api/uploads/cancel/:id`

Cancels an in-progress upload. Aborts the S3 multipart upload and deletes the Redis session.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — S3 uploadId |
| Cookie | `sessionId` |

No body required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Upload cancelled."
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 404 | Session not found | `"Invalid session id or already expired."` |

---

## 5. GET `/api/uploads/part-url/:id?partNumber=2`

Gets a **single** pre-signed PUT URL for a specific part number. Use this to retry a failed part upload.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — S3 uploadId |
| URL query | `partNumber` — number — the specific part to get a URL for |
| Cookie | `sessionId` |

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "url": [
      {
        "partNumber": 2,
        "contentLength": 1386502,
        "url": "https://s3.amazonaws.com/bucket/key?partNumber=2&uploadId=...&X-Amz-Signature=..."
      }
    ]
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | Invalid part number or already uploaded | `"Invalid part number or already acknowledged."` |
| 400 | All parts already done | `"Upload session already completed."` |
| 404 | Session not found or expired | `"Upload session already expired."` |

---

## 6. GET `/api/uploads/remaining-urls/:id`

Gets pre-signed PUT URLs for all **remaining** (not yet uploaded) parts — up to 10 at a time. Use this to resume an interrupted upload.

### Request

| Part | Value |
|------|-------|
| URL param | `:id` — S3 uploadId |
| Cookie | `sessionId` |

No body required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "file": {
      "id": "abc123XYZ...",
      "urls": [
        { "partNumber": 3,"contentLength" : 194646, "url": "https://s3.amazonaws.com/..." },
        { "partNumber": 4,"contentLength" : 194646, "url": "https://s3.amazonaws.com/..." }
      ],
      "requestType": "PUT",
      "remainingPartsCount": 2   // how many parts are still not uploaded
    }
  }
}
```

### Error Responses

| Status | Condition | message |
|--------|-----------|---------|
| 400 | All parts already uploaded | `"Upload session already completed."` |
| 404 | Session not found or expired | `"Upload session already expired."` |

---

## Frontend Implementation Notes

- **Part size** is determined by the server based on the user's `tier`. The client must split the file into chunks of exactly `partSize` bytes (last part can be smaller — `lastPartSize`).
- **PUT to S3** — use the pre-signed URL directly with `fetch` or `axios` using `method: "PUT"` and the raw file chunk as the body. Set `Content-Length` header to the chunk size.
- **ETag** — after each S3 PUT, read the `ETag` response header. Store it paired with lowercase `partNumber` and send to `/save/:id`.
- **Resume** — if the upload is interrupted, call `/remaining-urls/:id` to get URLs for unfinished parts, then continue uploading and saving progress.
- **Session expiry** — `sessionAlive` is the Redis TTL (soft, refreshed on activity — set to 200 min on initiate, 6 hrs on save/part-url). `expire` is the hard deadline (2 days). If `expire < Date.now()`, the session is dead — start over.
- **Chunk size** — `partSize` is returned in the `/initiate` response. Use it to slice the file: `file.slice(partSize * (partNumber - 1), partSize * partNumber)`.
