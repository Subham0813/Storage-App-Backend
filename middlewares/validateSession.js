import mongoose from "mongoose";
import { Session } from "../models/session.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { SUPER_ROLES } from "../controllers/adminControllers.js";
// import { DriveIntegration } from "../models/integration.model.js";

/**
 * Middleware: validateSession
 * what it do: Validate user session by verifying signed session cookie (sid), populating req.user object. Allows public access to files/directories with publicRole="VIEWER".
 * requirements:
 *   - req.signedCookies.sid: signed session id cookie (optional for public resources)
 *   - Session must exist in DB and be linked to a valid user
 *   - Sets req.user to authenticated user object from session
 */


export const validateSession = async (req, res, next) => {
  try {
    const { sid } = req.signedCookies;
    const { token } = req.query;

    //Signed User
    if (sid && mongoose.isValidObjectId(sid)) {
      const session = await Session.findById(sid).populate("userId").lean();

      if (session?.userId && !session.userId.isDeleted) {
        //check Admin for admin route
        if (
          req.baseUrl.includes("/admin") &&
          !SUPER_ROLES.includes(session.userId.role)
        )
          return res
            .status(401)
            .json({ success: false, message: "Unauthorized." });

        req.user = session.userId;
        return next();
      }
    }

    //Guest Access
    if (token) {
      const id = req.url.split("?")[0].split("/").pop();

      if (id && mongoose.isValidObjectId(id)) {
        let isValid = false;

        if (req.baseUrl.includes("/files")) {
          const file = await UserFile.findOne({ _id: id, shareToken: token })
            .select("_id")
            .lean();

          if (file) isValid = true;
        } else if (req.baseUrl.includes("/directories")) {
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

    return res.status(401).json({ success: false, message: "Unauthorized." });
  } catch (err) {
    next(err);
  }
};
