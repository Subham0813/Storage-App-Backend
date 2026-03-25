import mongoose from "mongoose";
import { badRequest } from "../utils/helper.js";
import { EMAIL_REGEX } from "../misc/constants.js";
import { emailSchema } from "../Schemas/authSchema.js";

/**
 * Middleware: shareHandlerPreProcessor
 * what it do: Validate and normalize sharing payload (`emailsWithRole`), build the DB `updateQuery` and attach `req.shareConfig` for `shareHandler`.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.body: { emailsWithRole?: [{ email, role }] }
 *   - Produces: `req.shareConfig` = { updateQuery, emailsToUpdate, accepted, skipped }
 */
export const shareHandlerPreProcessor = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return badRequest(res, "Invalid id.");

  const { emailsWithRole } = req.body;
  if (!emailsWithRole || !Array.isArray(emailsWithRole))
    return badRequest(res, "Invalid payload.");
  else if (
    emailsWithRole.length < 1 ||
    emailsWithRole.length > 100 //allowing 100 email, role for sharing at once
  )
    return badRequest(
      res,
      "Invalid payload. Array length should be between 1 and 100.",
    );

  const validMap = new Map();
  const isValid = emailsWithRole.every(({ email, role }) => {
    const { success, data } = emailSchema.safeParse(email);
    const cr = String(role).toUpperCase();

    if (success && ["VIEWER", "EDITOR"].includes(cr))
      validMap.set(data, { email: data, role: cr });
    return success && ["VIEWER", "EDITOR"].includes(cr);
  });

  if (!isValid) return badRequest(res, "Invalid payload.");

  const accepted = Array.from(validMap.values());
  const emailsToUpdate = accepted.map((v) => v.email);
  if (emailsToUpdate.length < 1) return badRequest(res, "Invalid emails.");

  const updateQuery = { $set: { sharedAt: new Date() } };
  if (accepted.length > 0)
    updateQuery.$push = { sharedWith: { $each: accepted } };

  req.shareConfig = { updateQuery, emailsToUpdate, accepted };
  next();
};
