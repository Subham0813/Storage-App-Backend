# OAuth Routes — Request & Response Reference

**Base path:** `/api/oauth`
**Auth required:** ❌ Public (Google/GitHub login) | ✅ Session required (Google Drive connect)
**Mechanism:** PKCE (Proof Key for Code Exchange) + signed state cookies

---

## Flow Overview

All OAuth flows follow the same pattern:

1. Frontend navigates (window.location or link) to the **`/connect`** endpoint — this is a **redirect**, not a fetch call.
2. Backend sets PKCE cookies and redirects the browser to the provider (Google/GitHub).
3. Provider redirects back to the **`/callback`** endpoint with `code` and `state`.
4. Backend verifies state, exchanges code, creates/updates user, sets `sessionId` cookie, and redirects to the frontend.

> **Important for frontend:** These are browser-navigation flows, not `fetch`/`axios` calls. The callback endpoints redirect back to `CLIENT_URL` with query params indicating success or error.

---

## Google OAuth (Login / Register / Link Account)

### 1. GET `/api/oauth/google/connect`

Initiates Google OAuth. Sets PKCE cookies and redirects browser to Google's authorization page.

**Auth:** Optional — if user is already logged in (has `sessionId` cookie), their account will be linked to Google instead of creating a new session.

**How to call:** Navigate the browser directly (not fetch)
```
window.location.href = "http://localhost:4000/api/oauth/google/connect"
```

**Side effect:** Sets signed cookie `oauth_google = { state, codeVerifier, session }` (httpOnly, 5 min)

**Response:** `302 Redirect` → Google authorization URL

---

### 2. GET `/api/oauth/google/callback`

Handles Google's redirect after user grants permission. This is called by Google, not the frontend directly.

**Query params (set by Google):**
```
?code=<auth_code>&state=<state_string>
// or on error:
?error=access_denied
```

**Requires:** Signed cookie `oauth_google` (set by `/connect`)

#### On Success

**Side effect:** Clears `oauth_google` cookie. Sets signed cookie `sessionId = { token: "<hex>", id: "<userId>" }` (httpOnly, 7 days, sameSite: lax)

**Redirects to:**
```
{CLIENT_URL}/google?google=connected
```

Frontend should read the `google=connected` query param to confirm success and then fetch `/api/user/info` to get the user object.

#### On Error

**Redirects to:**
```
{CLIENT_URL}/google?error=<error_code>
```

Possible error codes in query string:
| error query value | Meaning |
|---|---|
| `error=cookies_may_have_compromised` | State mismatch — CSRF attempt or stale cookie |
| `error=no_token_found` | Google didn't return an id_token |
| `error=no_valid_email_found` | Google profile has no email |
| `error=user_not_found` | DB lookup failed |
| `error=access_denied` | User denied Google permission |

---

## GitHub OAuth (Login / Register / Link Account)

### 3. GET `/api/oauth/github/connect`

Initiates GitHub OAuth. Sets PKCE cookies and redirects browser to GitHub's authorization page.

**Auth:** Optional — if user is already logged in, their account will be linked to GitHub.

**How to call:**
```
window.location.href = "http://localhost:4000/api/oauth/github/connect"
```

**Side effect:** Sets signed cookie `oauth_github = { state, codeVerifier, session }` (httpOnly, 5 min)

**Response:** `302 Redirect` → GitHub authorization URL

---

### 4. GET `/api/oauth/github/callback`

Handles GitHub's redirect after user grants permission.

**Query params (set by GitHub):**
```
?code=<auth_code>&state=<state_string>
// or on error:
?error=access_denied
```

**Requires:** Signed cookie `oauth_github`

#### On Success

**Side effect:** Clears `oauth_github` cookie. Sets signed cookie `sessionId = { token: "<hex>", id: "<userId>" }` (httpOnly, 7 days, sameSite: lax)

**Redirects to:**
```
{CLIENT_URL}/github?github=connected
```

#### On Error

**Redirects to:**
```
{CLIENT_URL}/github?error=<error_code>
```

Possible error codes:
| error query value | Meaning |
|---|---|
| `error=cookies_may_have_compromised` | State mismatch |
| `error=invalid_code` | Code exchange with GitHub failed |
| `error=no_access_token` | GitHub didn't return access token |
| `error=no_payload` | GitHub user profile fetch failed |
| `error=no_valid_email_found` | GitHub profile has no public email |
| `error=user_not_found` | DB lookup failed |

---

## Google Drive OAuth (Connect Integration)

### 5. GET `/api/oauth/google-drive/connect`

Initiates Google Drive OAuth to connect Drive as an integration for file import/backup. Requires the user to already be logged in.

**Auth:** ✅ Required — `sessionId` cookie (validated by `validateSession` middleware)

**How to call:**
```
window.location.href = "http://localhost:4000/api/oauth/google-drive/connect"
```

**Behavior:** If Drive is already connected and token is not expired, redirects immediately to:
```
{CLIENT_URL}?google-drive=connected
```

Otherwise sets PKCE cookies and redirects to Google for Drive scope authorization.

**Side effect:** Sets signed cookie `oauth_google_drive = { state, codeVerifier, session }` (httpOnly, 5 min)

**Response:** `302 Redirect` → Google authorization URL (scope: `drive.readonly`)

---

### 6. GET `/api/oauth/google-drive/callback`

Handles Google's redirect after user grants Drive permission. Stores the refresh token in the user's `integrations.googleDrive` field.

**Query params (set by Google):**
```
?code=<auth_code>&state=<state_string>
```

**Requires:** Signed cookie `oauth_google_drive`

#### On Success

Stores in DB:
```json
// User.integrations.googleDrive
{
  "accessToken": "<google_access_token>",
  "refreshToken": "<google_refresh_token>",
  "tokenExpiry": "2026-07-01T00:00:00.000Z"
}
```

**Redirects to:**
```
{CLIENT_URL}/google-drive?google-drive=connected
```

#### On Error

**Redirects to:**
```
{CLIENT_URL}/google-drive?error=<error_code>
```

Possible error codes:
| error query value | Meaning |
|---|---|
| `error=cookies_may_have_compromised` | State mismatch |
| `error=no_refresh_token` | Google didn't return a refresh token (user must re-consent) |
| `error=unable_to_create_integration:user_not_found` | DB update failed |

---

## Cookie Reference

| Cookie Name | Set By | Purpose | TTL |
|-------------|--------|---------|-----|
| `oauth_google` | `/google/connect` | PKCE state for Google login flow | 5 min |
| `oauth_github` | `/github/connect` | PKCE state for GitHub login flow | 5 min |
| `oauth_google_drive` | `/google-drive/connect` | PKCE state for Drive integration flow | 5 min |
| `sessionId` | `/google/callback`, `/github/callback` | Authenticates all protected routes | 7 days |

---

## Frontend Integration Notes

- All `/connect` endpoints must be opened as **full browser navigations**, not `fetch`/`axios` — they use `302 Redirect`.
- After callback, the frontend landing page (e.g. `/google`, `/github`, `/google-drive`) should:
  1. Read query params to detect `connected` or `error`.
  2. On success: call `GET /api/user/info` to get the updated user object.
  3. On error: display the error code to the user.
- The `sessionId` cookie is `httpOnly` — the frontend cannot read it directly. It is sent automatically with every request.
- For linking accounts (not new login), the user must already have a valid `sessionId` cookie before navigating to `/connect`.
