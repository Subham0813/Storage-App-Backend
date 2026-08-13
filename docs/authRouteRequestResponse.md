# Auth Routes — Request & Response Reference

**Base path:** `/api/auth`  
**Auth required:** ❌ None (these are public routes)  
**Cookie engine:** `cookie-parser` with `COOKIE_SECRET` — all cookies are **signed**  

---

## Flow Overview

The auth system uses a **2-step cookie handshake**:

1. `POST /login` or `POST /register` → validates credentials → sets a short-lived **`authToken`** signed cookie (5 min)
2. `POST /request-otp` → reads `authToken` cookie → sends OTP to email
3. `POST /verify-otp` → reads `authToken` cookie + OTP → creates session → sets **`sessionId`** signed cookie (7 days)

For password reset, the same flow applies but ends with a **`resetToken`** cookie instead of `sessionId`.

---

## 1. POST `/api/auth/register`

Registers a new user, creates their root directory, and sets an `authToken` cookie to begin OTP verification.

### Request

```json
// Body (JSON)
{
  "name": "John Doe",         // string, 3–50 chars, letters + single spaces only
  "email": "user@example.com", // valid email
  "password": "Secret@123"    // min 8 chars, must have uppercase, lowercase, number, symbol
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Register token created."
}
```

**Side effect:** Sets signed cookie `authToken = { purpose: "register", id: "<userId>" }` (httpOnly, 5 min, sameSite: strict)

### Error Responses

| Status | Condition                | message                                                  |
| ------ | ------------------------ | -------------------------------------------------------- |
| 400    | Validation failed        | e.g. `"Password must contain at least one uppercase..."` |
| 409    | Email already registered | `"User already registered."`                             |

---

## 2. POST `/api/auth/login`

Validates credentials and sets an `authToken` cookie to begin OTP verification.

### Request

```json
// Body (JSON)
{
  "email": "user@example.com",
  "password": "Secret@123"
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Login token created.",
  "data": { "isTwoFactorEnabled": false },
}
```

**Side effect:** Sets signed cookie `authToken = { purpose: "login", id: "<userId>" }` (httpOnly, 5 min, sameSite: strict)

### Error Responses

| Status | Condition         | message                           |
| ------ | ----------------- | --------------------------------- |
| 400    | Wrong credentials | `"Incorrect email or password."`  |

---

## 3. POST `/api/auth/request-otp`

Reads the `authToken` cookie and sends a 6-digit OTP to the user's email for the given purpose.

### Request

```json
// Body (JSON)
{
  "email": "user@example.com",
  "purpose": "login"           // "login" | "register" | "forgot-password"
}
```

**Requires:** Signed cookie `authToken` (set by `/login`, `/register`, or `/forgot-password-init`)

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "An One Time Password has been sent to your Email address.",
  "data": {
    "otpExpiresAt": "2026-01-01T12:05:00.000Z",  // Date — OTP valid for 5 minutes
    "activeSessions": 1                            // number — current active sessions
  }
}
```

### Error Responses

| Status | Condition                              | message                              |
| ------ | -------------------------------------- | ------------------------------------ |
| 400    | Missing/invalid `authToken` cookie     | `"Invalid cookies."`                 |
| 400    | `purpose` in body doesn't match cookie | `"Purpose not matched with cookie."` |
| 404    | User not found                         | `"Invalid email address or token."`  |

---

## 4. POST `/api/auth/verify-otp`

Verifies the OTP. On success for `login`/`register`: creates a session and sets `sessionId` cookie. For `forgot-password`: sets a `resetToken` cookie.

### Request

```json
// Body (JSON)
{
  "email": "user@example.com",
  "otp": "482910",              // string, exactly 6 digits
  "logoutLastSession": false    // boolean, optional — if true, evicts oldest session when limit reached
}
```

**Requires:** Signed cookie `authToken`

### Success Response (login/register) — `201 Created`

```json
{
  "success": true,
  "message": "Session created.",
  "data": {
    "user": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "name": "John Doe",
      "email": "user@example.com",
      "avatarUrl": "https://cdn.storage-app.dev/avatar/...",
      "role": "user",                        // "super_admin" | "admin" | "manager" | "user"
      "rootId": "64f1a2b3c4d5e6f7a8b9c0d2",  // user's root directory ObjectId string
      "usedQuota": 0,                        // bytes — storage used
      "authProviders": "email",              // string — connected providers (e.g. "email&google")
      "maxQuota": 5000000000,                // bytes — plan storage limit
      "maxBandwidthQuota": 10000000000,      // bytes — plan bandwidth limit
      "usedBandwidthQuota": 0,               // bytes — bandwidth used
      "plan": "FREE",                        // "FREE" | "PRO_MONTHLY" | "PRO_YEARLY" | "ULTRA_MONTHLY" | "ULTRA_YEARLY" | "PREMIUM_MONTHLY" | "PREMIUM_YEARLY" | "ELITE_MONTHLY" | "ELITE_YEARLY"
      "subscription": {},                    // {} for FREE users, or full subscription object
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
      "integrations": "",                    // string — connected integration keys (e.g. "googleDrive")
      "isLogged": true,
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

**Side effect:** Clears `authToken` cookie. Sets signed cookie `sessionId = { token: "<hex>", id: "<userId>" }` (httpOnly, 7 days, sameSite: lax)

### Success Response (forgot-password) — `200 OK`

```json
{
  "success": true,
  "message": "OTP verified."
}
```

**Side effect:** Clears `authToken` cookie. Sets signed cookie `resetToken = { token: "<hex>", id: "<userId>" }` (httpOnly, 5 min, sameSite: strict)

### Error Responses

| Status | Condition                                                    | message                                          |
| ------ | ------------------------------------------------------------ | ------------------------------------------------ |
| 400    | Missing `authToken` cookie                                   | `"Invalid cookies."`                             |
| 400    | Wrong OTP or email                                           | `"Invalid email or OTP."`                        |
| 404    | User not found                                               | `"User not found."`                              |
| 410    | OTP expired                                                  | `"OTP expired."`                                 |
| 413    | Max device sessions reached and `logoutLastSession` is false | `"Session creation failed. Max. limit reached."` |

---

## 5. POST `/api/auth/forgot-password-init`

Initiates the forgot-password flow. Verifies the email exists and sets an `authToken` cookie with purpose `forgot-password`.

### Request

```json
// Body (JSON)
{
  "email": "user@example.com"
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Reset token created. Proceed to create otp."
}
```

**Side effect:** Sets signed cookie `authToken = { purpose: "forgot-password", id: "<userId>" }` (httpOnly, 5 min, sameSite: strict)

### Error Responses

| Status | Condition            | message             |
| ------ | -------------------- | ------------------- |
| 400    | Invalid email format | validation message  |
| 404    | Email not found      | `"User not found."` |

---

## 6. POST `/api/auth/forgot-password`

Resets the user's password using the `resetToken` cookie set after OTP verification.

### Request

```json
// Body (JSON)
{
  "newPassword": "NewSecret@456"  // password format
}
```

**Requires:** Signed cookie `resetToken` (set by `verify-otp` when purpose is `forgot-password`)

### Success Response — `201 Created`

```json
{
  "success": true,
  "message": "Password changed."
}
```

**Side effect:** Clears `resetToken` cookie.

### Error Responses

| Status | Condition                | message                         |
| ------ | ------------------------ | ------------------------------- |
| 400    | Missing cookie or body   | `"Invalid cookies or payload."` |
| 400    | Token invalid or expired | `"Invalid or expired token."`   |

---

## 7. GET `/api/auth/2fa/generate`

Generates a TOTP secret and returns a QR code base64 string for setup. This temporarily saves the secret to the user but does not enable 2FA until it is verified.

### Request

No body required. Must be an authenticated user (requires `sessionId`).

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "qrCode": "data:image/png;base64,...",
    "manualSecret": "ABCDEF123456"
  }
}
```

---

## 8. POST `/api/auth/2fa/enable`

Verifies the first scanned code and locks 2FA to true.

### Request

```json
// Body (JSON)
{
  "token": "123456"  // 6-digit TOTP code
}
```

Requires `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "2FA successfully enabled."
}
```

### Error Responses

| Status | Condition | message |
| ------ | --------- | ------- |
| 400    | 2FA setup not initiated | `"2FA setup not initiated."` |
| 401    | Invalid code | `"Invalid code. Try again."` |

---

## 9. POST `/api/auth/verify-totp`

Verifies Authenticator code during login and creates the Redis stateful session. Used instead of `verify-otp` for users with 2FA enabled.

### Request

```json
// Body (JSON)
{
  "token": "123456",            // 6-digit TOTP code
  "logoutLastSession": false    // boolean, optional
}
```

**Requires:** Signed cookie `authToken` (with purpose `login`)

### Success Response — `201 Created`

Same as `verify-otp` success response, returns the user object and sets `sessionId`.

**Side effect:** Clears `authToken` cookie. Sets signed cookie `sessionId` (httpOnly, 7 days, sameSite: lax).

### Error Responses

| Status | Condition | message |
| ------ | --------- | ------- |
| 400    | Missing `authToken` or wrong purpose | `"Invalid cookies."` / `"Invalid session state."` |
| 400    | `token` not provided | `"Authenticator code required."` |
| 400    | 2FA not enabled on user | `"2FA not enabled."` |
| 400    | Invalid TOTP code | `"Invalid Authenticator code."` |
| 413    | Max device sessions reached | `"Session creation failed. Max. limit reached."` |

---

## Cookie Reference

| Cookie Name  | Set By                                         | Purpose                            | TTL    | Cleared By                      |
| ------------ | ---------------------------------------------- | ---------------------------------- | ------ | ------------------------------- |
| `authToken`  | `/login`, `/register`, `/forgot-password-init` | Authorizes OTP request/verify      | 5 min  | `verify-otp` (on success)       |
| `sessionId`  | `verify-otp` (login/register)                  | Authenticates all protected routes | 7 days | `/api/user/logout`              |
| `resetToken` | `verify-otp` (forgot-password)                 | Authorizes password reset          | 5 min  | `/forgot-password` (on success) |
