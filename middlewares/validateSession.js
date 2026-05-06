import mongoose from "mongoose";
// import { Session } from "../models/session.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { SUPER_ROLES, t } from "../misc/constants.js";
// import { DriveIntegration } from "../models/integration.model.js";
import { getErrorObject } from "../utils/helper.js";
import { redisClient } from "../configs/radis.js";
import { User } from "../models/user.model.js";

/**
 * Middleware: validateSession
 * what it do: Validate user session by verifying signed session cookie (sid), populating req.user object. Allows public access to files/directories with publicRole="VIEWER".
 * requirements:
 *   - req.signedCookies.sid: signed session id cookie (optional for public resources)
 *   - Session must exist in DB and be linked to a valid user
 *   - Sets req.user to authenticated user object from session
 */

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(",");
const MUTATING_METHODS = process.env.MUTATING_METHODS.split(",");

export const verifyCsrfOrigin = (req, res, next) => {
  if (
    process.env.NODE_ENV === "production" &&
    MUTATING_METHODS.includes(req.method)
  ) {
    const origin = req.headers["origin"];
    const referer = req.headers["referer"];
    const source = origin ?? (referer ? new URL(referer).origin : null);
    if (!source || !ALLOWED_ORIGINS.includes(source))
      return next(getErrorObject("Forbidden: invalid request origin.", 403));
  }
  next();
};

export const validateSession = async (req, res, next) => {
  try {
    const { sessionId } = req.signedCookies;
    const { token } = req.query;

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
          .populate("root", "name size")
          .lean();
        if (!user) {
          return next(getErrorObject("User not found or deleted.", 401));
        }
        await Promise.all([
          redisClient.json.set(userKey, "$", user),
          redisClient.expire(userKey, 300),
        ]);
      }

      if (user && !user.isDeleted) {
        if (req.url.includes("/admin") && !SUPER_ROLES.includes(user.role))
          return next(getErrorObject("Unauthorized", 403));

        // user.sessionId = sessionId;
        req.user = user;
        return next();
      }
    }

    //Guest Access
    if (token) {
      const id = req.url.split("?")[0].split("/").pop();

      if (id && mongoose.isValidObjectId(id)) {
        let isValid = false;

        if (req.url.includes("/files")) {
          const file = await UserFile.findOne({
            _id: id,
            "publicRole.shareToken": token,
          })
            .select("_id")
            .lean();

          if (file) isValid = true;
        } else if (req.url.includes("/directories")) {
          const dir = await Directory.findOne({
            _id: id,
            "publicRole.shareToken": token,
          })
            .select("_id")
            .lean();

          if (dir) isValid = true;
        }

        if (isValid) {
          req.user = { _id: "guest", email: null };
          req.tokenAuth = true;
          return next();
        }
      }
    }

    return next(getErrorObject("Unauthorized: validation failed.", 403));
  } catch (err) {
    next(err);
  }
};
