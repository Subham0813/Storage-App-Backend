# Upload Routes — Request & Response Reference

**Base path:** `/api/uploads`  
**Auth required:** ✅ All routes require a valid `sessionId` signed cookie  
**Upload mechanism:** S3/B2 Multipart Upload via pre-signed URLs (client uploads directly to storage bucket)  

---

## Upload Flow Overview

This is a **client-driven upload** — the backend never receives the file bytes. The client uploads each part directly to the storage bucket using pre-signed PUT URLs.

```
1. POST   /api/uploads/initiate
     → validates quota and maximum file size
     → creates upload session in Redis
     → returns uploadId + pre-signed PUT URLs

2. Client PUTs file chunks directly to storage bucket using the pre-signed URLs
     → Storage bucket returns an ETag for each uploaded part

3. PUT    /api/uploads/complete/:id
     → client sends all { partNumber, ETag } pairs
     → backend calls completeMultipartUpload (for multipart) or skips (for standard)
     → creates UserFile record in DB and increments parent directory sizes
     → returns the new file object

4. (On failure/cancel)
   DELETE /api/uploads/cancel/:id
     → aborts S3/B2 multipart upload
     → deletes Redis session
```

---

## Upload Types

| Type          | Condition         | Notes                                                    |
| ------------- | ----------------- | -------------------------------------------------------- |
| `standard`    | file size ≤ 5 MB  | Single pre-signed PUT URL. No S3 multipart.              |
| `multipart`   | file size > 5 MB  | Multiple pre-signed PUT URLs. S3 multipart upload.       |

For `standard` uploads, the `parts` array sent to `/complete/:id` must still contain `[{ partNumber: 1, ETag: "..." }]`.

---

## 1. POST `/api/uploads/initiate`

Creates a new upload session. Validates file size against user's storage quota and plan limits. Returns the `uploadId` and pre-signed PUT URLs.

### Request

```json
// Body (JSON)
{
  "file": {
    "name": "report.pdf",
    "size": 10485760,
    "mime": "application/pdf"
  },
  "targetId": "64f1a2b3c4d5e6f7a8b9c0d2"
}
```

| Field           | Type   | Notes                                                    |
| --------------- | ------ | -------------------------------------------------------- |
| `file.name`     | string | 1–255 chars, no special chars: `\ / : * ? " < > \|`     |
| `file.size`     | number | bytes, must be positive                                  |
| `file.mime`     | string | valid MIME type                                          |
| `targetId`      | string | ObjectId — destination directory                         |

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Upload initiated.",
  "data": {
    "session": {
      "id": "abc123XYZ...",
      "uploadType": "multipart",
      "userId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "report.pdf",
      "mime": "application/pdf",
      "size": 10485760,
      "totalParts": 2,
      "partSize": 5242880,
      "maxConcurrency": 4,
      "urls": [
        {
          "partNumber": 1,
          "contentLength": 5242880,
          "url": "https://b2-endpoint.com/bucket/key?partNumber=1&uploadId=..."
        },
        {
          "partNumber": 2,
          "contentLength": 5242880,
          "url": "https://b2-endpoint.com/bucket/key?partNumber=2&uploadId=..."
        }
      ],
      "requestType": "PUT",
      "expire": 1700000000000
    }
  }
}
```

> `uploadType` is `"standard"` for files ≤ 5 MB (single URL, `totalParts: 1`) or `"multipart"` for larger files.  
> `maxConcurrency` is plan-dependent — only present for `multipart` uploads.  
> `expire` is a Unix ms timestamp — the session hard-expires after 24 hours.

### Error Responses

| Status | Condition                  | message                                                                  |
| ------ | -------------------------- | ------------------------------------------------------------------------ |
| 400    | Validation failed          | e.g. `"Invalid mimetype"`                                                |
| 400    | Insufficient storage quota | `"Insufficient storage quota."`                                          |
| 413    | File exceeds plan limit    | `"File exceeds maximum allowed size of <N>GB."`                          |

---

## 2. PUT `/api/uploads/complete/:id`

Finalizes the upload. For `multipart` uploads, calls S3/B2 `CompleteMultipartUpload`. Then creates the `UserFile` record in MongoDB.

### Request

| Part      | Value               |
| --------- | ------------------- |
| URL param | `:id` — uploadId    |
| Cookie    | `sessionId`         |

```json
// Body (JSON)
{
  "parts": [
    { "partNumber": 1, "ETag": "\"d8e8fca2dc0f896fd7cb4cb0031ba249\"" },
    { "partNumber": 2, "ETag": "\"b026324c6904b2a9cb4b88d6d61c81d1\"" }
  ],
  "thumbnailBase64": "data:image/webp;base64,..."
}
```

| Field             | Type   | Required | Notes                                                    |
| ----------------- | ------ | -------- | -------------------------------------------------------- |
| `parts`           | array  | yes      | `[{ partNumber, ETag }]` — all parts must be included    |
| `thumbnailBase64` | string | no       | base64-encoded webp thumbnail for image/video files      |

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "File uploaded.",
  "data": {
    "item": {
      "file": {
        "id": "64f1a2b3c4d5e6f7a8b9c0d9",
        "parentId": "64f1a2b3c4d5e6f7a8b9c0d2",
        "userId": "64f1a2b3c4d5e6f7a8b9c0d1",
        "name": "report.pdf",
        "mime": "application/pdf",
        "extension": "pdf",
        "size": 10485760,
        "isDeleted": false,
        "isStarred": false,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      }
    }
  }
}
```

### Error Responses

| Status | Condition                      | message                                    |
| ------ | ------------------------------ | ------------------------------------------ |
| 400    | Missing or empty `parts`       | `"ETags with part numbers are required."`  |
| 400    | Not all parts uploaded yet     | `"All parts must be uploaded first."`      |
| 404    | Session not found              | `"Invalid session id or already expired."` |
| 410    | Session hard-expired           | `"Upload session expired."`                |
| 500    | S3 multipart completion failed | `"Failed to complete multipart upload."`   |

---

## 3. DELETE `/api/uploads/cancel/:id`

Cancels an in-progress upload. Aborts the S3/B2 multipart upload and deletes the Redis session.

### Request

| Part      | Value            |
| --------- | ---------------- |
| URL param | `:id` — uploadId |
| Cookie    | `sessionId`      |

No body required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Upload cancelled."
}
```

### Error Responses

| Status | Condition         | message                                    |
| ------ | ----------------- | ------------------------------------------ |
| 404    | Session not found | `"Invalid session id or already expired."` |

---

## Frontend Implementation Notes

- **Part size** is determined by the server based on the user's plan. For files `> 5MB`, split the file into chunks of exactly `partSize` bytes (the last part can be smaller).
- **PUT to S3/B2** — use the pre-signed URL directly with `fetch` or `axios` using `method: "PUT"` and the raw file chunk as the body.
- **ETag** — after each S3/B2 PUT, read the `ETag` response header. Store it paired with the `partNumber` and send the complete list to `/complete/:id` as `parts`.
- **Standard uploads** — for files ≤ 5 MB, there is only one URL and one part. Still send `parts: [{ partNumber: 1, ETag: "..." }]` to `/complete/:id`.
- **Session expiry** — `expire` is the hard deadline (24 hours). If `expire < Date.now()`, the session is dead — start over.
