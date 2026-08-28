import { redisClient } from "../configs/redis.js";

/**
 * Lightweight Redis response-cache helpers.
 *
 * Convention: every key is namespaced under `storageApp:cache:` so these
 * read-only payloads can be invalidated (`del`) independently from the
 * session/user-auth caches (`storageApp:user:...`).
 *
 * All helpers are fail-open: if Redis errors or is unreachable, we log and
 * fall through to the real computation so caching NEVER breaks a request.
 */

export const cacheNs = {
  user: (scope, userId) => `storageApp:cache:user:${userId}:${scope}`,
  global: (scope) => `storageApp:cache:global:${scope}`,
  folder: (scope, userId, folderId) =>
    `storageApp:cache:user:${userId}:folder:${folderId}:${scope}`,
};

/**
 * Return the cached JSON value for `key` if present, else `null`.
 *
 * NOTE: this driver's `json.get(key, "$")` returns the decoded value directly
 * (not a JSONPath array of matches), so we must NOT dereference `[0]` — doing
 * so would unwrap arrays to their first element.
 */
export async function cacheGet(key) {
  try {
    const value = await redisClient.json.get(key, "$");
    return value ?? null;
  } catch (err) {
    console.error("ResponseCache: get failed", err?.message);
    return null;
  }
}

/**
 * Persist `value` (any JSON-serializable value) under `key` for `ttlSec`.
 */
export async function cacheSet(key, value, ttlSec) {
  try {
    if (value === undefined || value === null) return;
    await redisClient.json.set(key, "$", value);
    if (ttlSec && ttlSec > 0) await redisClient.expire(key, ttlSec);
  } catch (err) {
    console.error("ResponseCache: set failed", err?.message);
  }
}

/**
 * Invalidate a cache key (best-effort). Safe to call fire-and-forget.
 */
export async function cacheDel(key) {
  try {
    await redisClient.del(key);
  } catch (err) {
    console.error("ResponseCache: del failed", err?.message);
  }
}

/**
 * Bust every per-user response-cache key (info/usage/stats/plan). Call after
 * any mutating operation that changes a user's quota, plan, profile or stats.
 * Accepts an ObjectId or a string id.
 */
export async function invalidateUser(userId) {
  const uid = userId?.toString ? userId.toString() : String(userId);
  try {
    await Promise.all([
      cacheDel(cacheNs.user("info", uid)),
      cacheDel(cacheNs.user("usage", uid)),
      cacheDel(cacheNs.user("stats", uid)),
      cacheDel(cacheNs.user("plan", uid)),
    ]);
  } catch (err) {
    console.error("ResponseCache: invalidateUser failed", err?.message);
  }
}

/**
 * Cache-aside wrapper for controllers.
 *
 *   const payload = await cacheWrap("storageApp:cache:global:plans", 900, async () => { ... });
 *
 * If a cached value exists it is returned immediately; otherwise `compute`
 * runs and its result is stored. Redis failures fall through to `compute`.
 */
export async function cacheWrap(key, ttlSec, compute) {
  const cached = await cacheGet(key);
  if (cached != null) return cached;

  const value = await compute();
  await cacheSet(key, value, ttlSec);
  return value;
}
