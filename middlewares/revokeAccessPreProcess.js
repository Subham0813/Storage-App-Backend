/**
 * Middleware: revokeAccessPreProcessor
 * what it do: Validate and normalize revoking payload (`emails`), build the DB `updateQuery` and attach `req.revokeConfig` for `revokeAccessHandler`.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.body: { emails?: [string] }
 *   - Produces: `req.shareConfig` = { updateQuery, emailsToUpdate, formattedPublicRole }
 */
export const revokeAccessPreProcessor = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  const { emails, publicRole } = req.body;
  const formattedPublicRole = publicRole
    ? String(publicRole).toUpperCase()
    : undefined;

  if (
    !emails ||
    !Array.isArray(emails) ||
    (formattedPublicRole && formattedPublicRole !== "NONE")
  )
    return next(getErrorObject("Invalid payload."));

  const emailsToUpdate = [];

  const isValid = emails.every((email) => {
    const { success, data } = emailSchema.safeParse(email);
    if (success) emailsToUpdate.push(data);
    return success;
  });

  if (!isValid)
    return next(getErrorObject("Invalid `emails`. Must contain valid emails."));

  let updateQuery = {};
  if (emailsToUpdate.length > 0)
    updateQuery.$pull = { sharedWith: { email: { $in: emailsToUpdate } } };
  if (formattedPublicRole)
    updateQuery.$set = { publicRole: formattedPublicRole };

  req.revokeConfig = { updateQuery, emailsToUpdate, formattedPublicRole };
  next();
};
