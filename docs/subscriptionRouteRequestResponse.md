# Payment & Subscription Routes — Request & Response Reference

**Base path:** `/api/subscriptions`  
**Auth required:** ✅ All routes except `/plans` require a valid `sessionId` signed cookie  
**Payment provider:** Razorpay  
**Mode guard:** All routes under `/api/subscriptions` return `404` with `"Billing is disabled in self-hosted mode."` when `APP_MODE !== "saas"`. The `/plans` endpoint and webhook are still accessible regardless.

---

## Plan Tiers & Limits

| Plan Key | Billing | Price (INR) | Storage | Max File Size | Max Devices | Bandwidth/mo | Trash Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `FREE` | — | ₹0 | 2 GB | 100 MB | 1 | 5 GB | 5 days |
| `PRO_MONTHLY` | Monthly | ₹99 | 100 GB | 2 GB | 3 | 200 GB | 15 days |
| `PRO_YEARLY` | Yearly | ₹999 | 100 GB | 2 GB | 3 | 200 GB | 15 days |
| `BUSINESS_MONTHLY` | Monthly | ₹299 | 500 GB | 10 GB | 5 | 1 TB | 30 days |
| `BUSINESS_YEARLY` | Yearly | ₹2999 | 500 GB | 10 GB | 5 | 1 TB | 30 days |

---

## 1. GET `/api/subscriptions/plans`

Returns all available subscription plan options formatted for a pricing page. **No auth required.**

> **Note:** This route is mounted directly in `app.js` outside the `subscriptionRoutes` router and therefore bypasses the `requireSaasMode` guard. It is accessible even when `APP_MODE !== "saas"`.

### Request

No body. No auth.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "plans": [
      {
        "name": "PRO",
        "baseKey": "PRO",
        "quota": 100,
        "priceMo": 99,
        "priceYr": 999,
        "discountTag": "Save 17%",
        "isPopular": true,
        "features": [
          "100GB Cloud Storage",
          "Fast parallel uploads (4x)",
          "Public link sharing enabled",
          "Sync across 3 devices",
          "15-day trash auto-recovery",
          "14-day post-expiry grace period",
          "200GB monthly bandwidth"
        ]
      },
      {
        "name": "BUSINESS",
        "baseKey": "BUSINESS",
        "quota": 500,
        "priceMo": 299,
        "priceYr": 2999,
        "discountTag": "Save 17%",
        "isPopular": false,
        "features": [
          "500GB Cloud Storage",
          "Ultra-fast parallel uploads (8x)",
          "Full public link sharing & team tools",
          "Sync across 5 devices",
          "30-day trash auto-recovery",
          "30-day post-expiry grace period",
          "1TB monthly bandwidth"
        ]
      }
    ]
  }
}
```

> `name` is the raw plan base key (e.g. `"PRO"`, `"BUSINESS"`), not title-cased.
> `isPopular` is `true` for `PRO` only.

---

## 2. GET `/api/subscriptions/current-plan`

Returns the logged-in user's current plan details, usage, and limits.

### Request

No body. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "plan": {
      "name": "PRO_MONTHLY",
      "billingCycle": "monthly",
      "priceInRupees": 99,
      "status": "active",
      "maxQuota": 100000000000,
      "usedQuota": 643763,
      "startedAt": "2026-06-01T00:00:00.000Z",
      "renewAt": "2026-07-01T00:00:00.000Z",
      "expireAt": null,
      "endedAt": null,
      "cancelAtPeriodEnd": false,
      "invoiceUrl": "https://rzp.io/i/...",
      "limits": {
        "quotaBytes": 100000000000,
        "maxFileSize": 2000000000,
        "chunkSize": 8388608,
        "monthlyBandwidthLimit": 200000000000,
        "maxUploadConcurrency": 4,
        "maxDevices": 3,
        "canCreatePublicLinks": true,
        "trashRetentionDays": 15,
        "gracePeriod": 14
      }
    }
  }
}
```

> This endpoint always returns the same shape regardless of FREE or paid plan.  
> For FREE users: `billingCycle`, `status`, `startedAt`, `renewAt`, `expireAt`, `endedAt` will be `null`/`""`, and `limits` will reflect FREE plan values.  
> `status` values: `"created"` | `"active"` | `"cancelled"` | `"downgrade pending"` | `"halted"` | `"completed"` | `"abandoned"` | `"upgraded"`

---

## 3. GET `/api/subscriptions/history`

Returns the subscription history for the authenticated user, sorted newest first, only the last 10 subscriptions.

### Request

No body. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "history": [
      {
        "name": "PRO_MONTHLY",
        "billingCycle": "monthly",
        "status": "active",
        "startedAt": "2026-06-01T00:00:00.000Z",
        "renewAt": "2026-07-01T00:00:00.000Z",
        "endedAt": null,
        "subscribedAt": "2026-06-01T00:00:00.000Z",
        "invoiceUrl": "https://rzp.io/i/..."
      }
    ]
  }
}
```

---

## 4. POST `/api/subscriptions/create`

Initializes a new subscription order on Razorpay. Returns the Razorpay subscription ID to pass to the Razorpay checkout SDK.

### Request

```json
// Body (JSON)
{
  "plan": "PRO_MONTHLY" //or "pro_monthly" case-insensitive
}
```

### Success Response — `201 Created`

```json
{
  "success": true,
  "data": {
    "subscriptionId": "sub_K3aB2xyz..."
  }
}
```

> If a pending subscription for the same plan was created within the last 15 minutes, the existing `subscriptionId` is returned with `200 OK`.

### Error Responses

| Status | Condition                            | message                                                                                                    |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 400    | Invalid or missing plan              | `"Invalid plan selected."`                                                                                 |
| 400    | Already has an active subscription   | `"You already have an active subscription. Please use the 'Change Plan' option to upgrade or downgrade."` |
| 400    | Current usage exceeds new plan quota | `"Cannot downgrade to a plan with lower quota than your current usage."`                                   |

---

## 5. POST `/api/subscriptions/verify`

Cryptographically verifies the Razorpay payment signature after checkout and activates the subscription.

### Request

```json
// Body (JSON)
{
  "razorpay_payment_id": "pay_xyz789...",
  "razorpay_subscription_id": "sub_K3aB2xyz...",
  "razorpay_signature": "9ef4dffbfd84f1318f6739a3..."
}
```

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Subscription verified."
}
```

### Error Responses

| Status | Condition                      | message                                                 |
| ------ | ------------------------------ | ------------------------------------------------------- |
| 400    | Missing payment credentials    | `"Missing required payment credentials."`               |
| 400    | Invalid plan in Razorpay notes | `"Invalid plan associated with this order."`            |
| 403    | Signature mismatch             | `"Cryptographic signature mismatch. Payment rejected."` |

---

## 6. PATCH `/api/subscriptions/update`

Upgrades or downgrades the user's active subscription plan.

- **Upgrade** — creates a new Razorpay subscription immediately. Applies a prorated 50% credit for unused billing days if within the first half of the cycle. Returns a new `subscriptionId` for the frontend to complete checkout.
- **Downgrade** — schedules the plan change at `cycle_end`. Blocked if current storage usage exceeds the new plan's quota.

### Request

```json
// Body (JSON)
{
  "plan": "BUSINESS_MONTHLY" //case insensitive
}
```

### Success Response — `200 OK` (Upgrade)

```json
{
  "success": true,
  "data": {
    "subscriptionId": "sub_K3aB3abc...",
    "requiresUpiFallback": true,
    "creditApplied": 24.50
  }
}
```

> `creditApplied` is in Rupees. `0` if no credit was applied.

### Success Response — `200 OK` (Downgrade)

```json
{
  "success": true,
  "message": "Downgrade scheduled for the end of your billing cycle."
}
```

### Error Responses

| Status | Condition                          | message                                                                                                                                       |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | No active subscription             | `"No active subscription found to modify."`                                                                                                   |
| 400    | Already on the requested plan      | `"You are already on this plan."`                                                                                                             |
| 400    | Downgrade blocked by storage usage | `"Downgrade blocked. You are using more storage than the <PLAN> plan allows. Please delete at least <N> GB of files before downgrading."`     |
| 400    | UPI mandate cannot be scheduled    | `"UPI mandates cannot be scheduled for downgrades. Please cancel your current plan and subscribe to the lower plan when it expires."`         |

---

## 7. PATCH `/api/subscriptions/cancel`

Schedules cancellation of the active subscription at the end of the current billing period.

### Request

No body. Just the `sessionId` cookie.

### Success Response — `200 OK`

```json
{
  "success": true,
  "message": "Subscription cancelled successfully. You will keep your storage limits until the end of your billing cycle."
}
```

### Error Responses

| Status | Condition              | message                           |
| ------ | ---------------------- | --------------------------------- |
| 400    | No active subscription | `"No active subscription found."` |
| 500    | Razorpay error         | `"Failed to cancel subscription. Please contact support."` |

---

## 8. POST `/api/subscriptions/webhook`

Razorpay event webhook. Verifies the HMAC-SHA256 signature and processes subscription lifecycle events. **Not a client-facing route.**

**Auth:** HMAC-verified via `x-razorpay-signature` header. No session cookie.

### Request

```
Header: x-razorpay-signature: <hmac_sha256_signature>
Content-Type: application/json
```

Body is the raw Razorpay event payload. Relevant fields used internally:

```json
{
  "event": "subscription.charged",
  "payload": {
    "subscription": {
      "entity": {
        "id": "sub_K3aB2xyz...",
        "status": "active",
        "current_start": 1700000000,
        "current_end": 1702592000,
        "paid_count": 1,
        "short_url": "https://rzp.io/i/...",
        "ended_at": null,
        "cancel_reason": null,
        "notes": {
          "userId": "64f1a2b3c4d5e6f7a8b9c0d1",
          "plan": "PRO_MONTHLY",
          "isUpgrade": "false",
          "oldSubId": null
        }
      }
    },
    "invoice": {
      "entity": {
        "short_url": "https://rzp.io/i/invoice...",
        "amount": 9900,
        "subscription_id": "sub_K3aB2xyz..."
      }
    }
  }
}
```

### Handled Events

| Event                      | Action                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `subscription.charged`     | Updates user `plan`, `maxQuota`, `subscriptionExpiresAt`. Cancels old sub if upgrade.       |
| `subscription.resumed`     | Same as `subscription.charged`.                                                             |
| `subscription.halted`      | Updates subscription `status` in DB only.                                                   |
| `subscription.cancelled`   | Updates subscription `status` in DB only.                                                   |
| `subscription.completed`   | Updates subscription `status` in DB only.                                                   |
| `invoice.paid`             | Stores `invoiceUrl` on the subscription record and sends invoice email to the user.         |

### Success Responses

| Status | Condition                                    | Body          |
| ------ | -------------------------------------------- | ------------- |
| 200    | Event processed successfully                 | *(empty)*     |
| 200    | Event has no `userId` in notes (ignored)     | *(empty)*     |

### Error Responses

| Status | Condition                        | Body (JSON)                          |
| ------ | -------------------------------- | ------------------------------------ |
| 400    | HMAC signature mismatch          | `{ "status": "Invalid Signature" }`  |
| 500    | Unexpected server error          | *(empty)*                            |


