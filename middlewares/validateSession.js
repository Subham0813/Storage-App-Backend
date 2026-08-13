import mongoose from "mongoose";
// import { Session } from "../models/session.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { SUPER_ROLES, t } from "../misc/constants.js";
// import { DriveIntegration } from "../models/integration.model.js";
import { getErrorObject, safeCompare } from "../utils/helper.js";
import { redisClient } from "../configs/redis.js";
import { User } from "../models/user.model.js";

/**
 * Middleware: validateSession
 * what it do: Validate user session by verifying signed session cookie (sid), populating req.user object. Allows public access to files/directories with publicRole="view".
 * requirements:
 *   - req.signedCookies.sid: signed session id cookie (optional for public resources)
 *   - Session must exist in DB and be linked to a valid user
 *   - Sets req.user to authenticated user object from session
 */

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());
const MUTATING_METHODS = (process.env.MUTATING_METHODS || "POST,PATCH,PUT,DELETE")
  .split(",")
  .map((m) => m.trim().toUpperCase());

export const verifyCsrfOrigin = (req, res, next) => {
  const origin = req.headers["origin"];
  const referer = req.headers["referer"];
  const source = origin ?? (referer ? new URL(referer).origin : null);

  if (MUTATING_METHODS.includes(req.method)) {
    // 1. Origin / Referer must be one of our allowed origins
    if (!source || !ALLOWED_ORIGINS.includes(source))
      return next(getErrorObject("Forbidden: invalid request origin.", 403));

    // 2. Double-submit CSRF: the X-CSRF-Token header must match the csrf cookie.
    //    A missing cookie means the session predates CSRF enforcement — treat
    //    it like an unauthenticated request (401) so the client re-logs in.
    const csrfToken = req.headers["x-csrf-token"];
    if (!req.cookies.csrf) {
      return next(
        getErrorObject("Session expired. Please login again.", 401),
      );
    }
    if (!safeCompare(csrfToken, req.cookies.csrf)) {
      return next(getErrorObject("Forbidden: invalid CSRF token.", 403));
    }
  }
  next();
};

export const validateSession = async (req, res, next) => {
  try {
    const { sessionId } = req.signedCookies;

    //Signed User
    if (sessionId) {
      const sessionKey = `storageApp:user:${sessionId.id}:session:${sessionId.token}`;
      const savedSession = await redisClient.json.get(sessionKey);

      if (!savedSession)
        return next(getErrorObject("Unauthorized. Please login again.", 401));

      const ttl = await redisClient.ttl(sessionKey);
      const newTTL = ttl < t._day ? 6 * t._day : null;
      if (newTTL) await redisClient.expire(sessionKey, newTTL);

      const userKey = `storageApp:user:${sessionId.id}:userdata`;
      let user = await redisClient.json.get(userKey, "$");

      if (!user) {
        user = await User.findById(sessionId.id)
          .populate("root")
          .populate("subscription")
          .lean();

        if (!user) {
          const indexKey = `storageApp:user:${sessionId.id}:session_index`;
          await redisClient.del(userKey);
          await redisClient.del(sessionKey);
          await redisClient.sRem(indexKey, sessionKey);

          return res
            .clearCookie("sessionId")
            .status(404)
            .json({ success: false, message: "User not found or deleted." });
        }

        await Promise.all([
          redisClient.json.set(userKey, "$", user),
          redisClient.expire(userKey, t._min),
        ]);
      }

      if (user.isDeleted) {
        const indexKey = `storageApp:user:${sessionId.id}:session_index`;
        await redisClient.del(userKey);
        await redisClient.del(sessionKey);
        await redisClient.sRem(indexKey, sessionKey);

        return res
          .clearCookie("sessionId")
          .status(403)
          .json({
            success: false,
            message: "Your account has been banned. Contact support.",
          });
      }

      // Keep the userdata cache alive while the user keeps making requests,
      // so isActive (exists(userdata)) stays true during active use.
      await redisClient.expire(userKey, t._min);

      // Live liveness bookkeeping (fire-and-forget — never block the request).
      Promise.allSettled([
        redisClient.zAdd("storageApp:active_users", {
          score: Math.floor(Date.now() / 1000),
          value: `${sessionId.id}`,
        }),
        redisClient
          .set(`storageApp:user:${sessionId.id}:last_active_ts`, "1", {
            NX: true,
            EX: 300,
          })
          .then((res) =>
            res === "OK"
              ? User.updateOne(
                  { _id: sessionId.id },
                  { $set: { lastActiveAt: new Date() } },
                  { runValidators: false },
                )
              : null,
          ),
      ]);

      if (req.url.includes("/admin") && !SUPER_ROLES.includes(user?.role))
        return next(getErrorObject("Forbidden: only admins are allowed.", 403));

      req.sessionToken = sessionId.token;
      req.user = user;
      return next();
    }

    // Guest access for public share links (?token=). The token itself is NOT
    // trusted here — route-level `checkAccess` re-validates it against the item
    // (direct match + shared-directory ancestry + expiry + isDeleted) before
    // any data is served, so an invalid/forged token fails closed with 403.
    const { token } = req.query;
    if (
      token &&
      req.method === "GET" &&
      (req.url.includes("/api/files") || req.url.includes("/api/directories"))
    ) {
      const id = req.url.split("?")[0].split("/").pop();
      if (id && mongoose.isValidObjectId(id)) {
        req.user = { _id: "guest", email: null };
        return next();
      }
    }

    return next(getErrorObject("Unauthorized. Please login again.", 401));
  } catch (err) {
    next(err);
  }
};

export const verifyShareToken = async (req, res, next) => {
  try {
    let token = req.params.token;
    if (!token) return next(getErrorObject("Token not found.", 404));

    const query = {
      shareToken: token,
      publicRole: "view",
      // isDeleted: false,
      // $or: [
      //   { shareTokenExpiresAt: { $gt: Date.now() } },
      //   { shareTokenExpiresAt: null },
      // ],
    };

    const d = await Directory.findOne(query)
      .select("_id name size shareTokenExpiresAt isDeleted")
      .lean();

    if (d) {
      if (d.shareTokenExpiresAt && d.shareTokenExpiresAt < new Date()) {
        return next(getErrorObject("Token expired.", 403));
      }

      if (d.isDeleted) {
        return next(getErrorObject("Folder has been deleted.", 404));
      }

      return res.status(200).json({
        success: true,
        message: req.user? "" : "Please login to get full access.",
        item: {
          id: d._id.toString(),
          name: d.name,
          size: d.size,
          type: "directory",
        },
      });
    }

    const f = await UserFile.findOne(query)
      .populate("userId", "_id name email avatarUrl")
      .populate("path", "_id name", { isDeleted: false })
      .lean();

    if (!f) {
      return next(getErrorObject("Invalid token.", 404));
    }

    if (f.shareTokenExpiresAt && f.shareTokenExpiresAt < new Date()) {
      return next(getErrorObject("Token expired.", 403));
    }

    if (f.isDeleted) {
      return next(getErrorObject("File has been deleted.", 404));
    }

    // Owner is NOT the caller: keep req.user unset (guest) and expose the
    // content owner separately so quota/bandwidth/limits bill the owner while
    // req.user stays undefined for anything that assumes an authenticated caller.
    req.itemOwner = await User.findById(f.userId._id);
    req.tokenAuth = true;
    req.Item = f;

    next();
  } catch (err) {
    next(err);
  }
};
