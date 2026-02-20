import mongoose from "mongoose";
import { base64URLEncode } from "../controllers/oauthControllers.js";
import { badRequest } from "../utils/helper.js";
import crypto from "node:crypto";

/**
 * Middleware: shareHandlerPreProcessor
 * what it do: Validate and normalize sharing payload (`emailsWithRole`), build the DB `updateQuery` and attach `req.shareConfig` for `shareDirectoryHandler`.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.body: { emailsWithRole?: [{ email, role }] }
 *   - Produces: `req.shareConfig` = { updateQuery, emailsToUpdate, accepted, skipped }
 */
export const shareHandlerPreProcessor = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  const { emailsWithRole } = req.body;
  if (
    !emailsWithRole ||
    !Array.isArray(emailsWithRole) ||
    emailsWithRole.length < 1
  )
    return badRequest(res, "Invalid payload.");

  const allowedRoles = ["VIEWER", "EDITOR"];
  const skipped = [];
  const validMap = new Map();

  emailsWithRole.forEach(({ email, role }) => {
    const ce = email.toLowerCase().trim();
    const cr = role.toUpperCase();
    if (
      !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ce) ||
      !allowedRoles.includes(cr)
    ) {
      skipped.push({
        email: ce,
        role: cr,
        reason: "Invalid `email` or `role`.",
      });
    } else validMap.set(ce, { email: ce, role: cr });
  });

  const accepted = Array.from(validMap.values());
  const emailsToUpdate = accepted.map((v) => v.email);
  if (emailsToUpdate.length < 1) return badRequest(res, "Invalid emails.");

  const updateQuery = { $set: { sharedAt: new Date() } };
  if (accepted.length > 0)
    updateQuery.$push = { sharedWith: { $each: accepted } };

  req.shareConfig = { updateQuery, emailsToUpdate, accepted, skipped };
  next();
};
