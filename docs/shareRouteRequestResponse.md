# Public Share Routes — Request & Response Reference

**Base path:** `/api/public/shared`  
**Auth required:** ❌ No session required — uses share token in URL path  
**Middleware:** `verifyShareToken` — validates the token against the shared item and checks `publicRole = "view"` and `shareTokenExpiresAt`  

---

## How It Works

These routes allow unauthenticated access to publicly shared files using a share token. The token is embedded in the URL path (not a query param).

If the token belongs to a **directory** (not a file), the server returns a `200` response prompting the user to log in for full access.

---

## 1. GET `/api/public/shared/:token`

Returns a short-lived signed Cloudflare CDN URL for **inline preview** of the shared file.

### Request

| Part      | Value                         |
| --------- | ----------------------------- |
| URL param | `:token` — public share token |

No cookie required.

### Success Response — `200 OK` (file)

```json
{
  "success": true,
  "data": {
    "url": "https://cdn.example.com/stream?token=eyJVc2VySWQiOi..."
  }
}
```

### Success Response — `200 OK` (directory token)

```json
{
  "success": true,
  "message": "Please login to get full access."
}
```

### Error Responses

| Status | Condition                                 | message                                                 |
| ------ | ----------------------------------------- | ------------------------------------------------------- |
| 403    | Bandwidth limit exceeded                  | `"Bandwidth limit exceeded. Please upgrade your plan."` |
| 404    | Token not found, expired, or file deleted | `"Share link is expired or not found."`                 |

---

## 2. GET `/api/public/shared/:token/download`

Returns a short-lived signed Cloudflare CDN URL for **downloading** the shared file.

### Request

| Part      | Value                         |
| --------- | ----------------------------- |
| URL param | `:token` — public share token |

No cookie required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "url": "https://cdn.example.com/download?token=eyJVc2VySWQiOi..."
  }
}
```

### Error Responses

| Status | Condition                                 | message                                                 |
| ------ | ----------------------------------------- | ------------------------------------------------------- |
| 403    | Bandwidth limit exceeded                  | `"Bandwidth limit exceeded. Please upgrade your plan."` |
| 404    | Token not found, expired, or file deleted | `"Share link is expired or not found."`                 |

---

## 3. GET `/api/public/shared/:token/info`

Returns shared item metadata. For guest file access, owner info is omitted.

### Request

| Part      | Value                         |
| --------- | ----------------------------- |
| URL param | `:token` — public share token |

No cookie required.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "report.pdf",
      "extension": "pdf",
      "mime": "application/pdf",
      "size": 204800,
      "path": [
        { "id": "...", "name": "Documents" }
      ],
      "isStarred": false,
      "isDeleted": false,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

### Error Responses

| Status | Condition                                 | message                                 |
| ------ | ----------------------------------------- | --------------------------------------- |
| 404    | Token not found, expired, or file deleted | `"Share link is expired or not found."` |
