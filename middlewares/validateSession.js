import mongoose from "mongoose";
import { Session } from "../models/session.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { SUPER_ROLES } from "../misc/constants.js";
import { DriveIntegration } from "../models/integration.model.js";
import { getErrorObject } from "../utils/helper.js";

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
    const { sid } = req.signedCookies;
    const { token } = req.query;

    //Signed User
    if (sid && mongoose.isValidObjectId(sid)) {
      const session = await Session.findById(sid)
        .populate("userId", "-__v -createdAt -updatedAt")
        .lean();

      if (session?.userId && !session.userId.isDeleted) {
        //check Admin for admin route
        if (
          req.url.includes("/admin") &&
          !SUPER_ROLES.includes(session.userId.role)
        )
          return next(getErrorObject("Unauthorized: Access denied.", 401));
        req.user = session.userId;
        return next();
      }
    }

    //Guest Access
    if (token) {
      const id = req.url.split("?")[0].split("/").pop();

      if (id && mongoose.isValidObjectId(id)) {
        let isValid = false;

        if (req.url.includes("/files")) {
          const file = await UserFile.findOne({ _id: id, shareToken: token })
            .select("_id")
            .lean();

          if (file) isValid = true;
        } else if (req.url.includes("/directories")) {
          const dir = await Directory.findOne({ _id: id, shareToken: token })
            .select("_id")
            .lean();

          if (dir) isValid = true;
        }

        if (isValid) {
          req.user = { _id: "guest", email: null };
          req.isTokenAuthorized = true;
          return next();
        }
      }
    }

    return next(getErrorObject("Unauthorized: Access denied.", 401));
  } catch (err) {
    next(err);
  }
};
