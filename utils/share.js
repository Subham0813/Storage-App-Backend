import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

const maxDepth = 5;

/**
 * Utility: shareDirectoryRecursive
 * what it do: Recursively apply sharing updates to all files and sub-directories under a parent directory.
 * requirements:
 *   - parentId: ObjectId (directory) to start updates from
 *   - session: mongoose session instance for transactional updates
 *   - emailsToUpdate: Array<string> of emails to remove from `sharedWith` (optional)
 *   - updateQuery: MongoDB update object to apply to matched UserFile/Directory documents
 *   - depth: (internal) current recursion depth; stops when exceeding `maxDepth`
 * behavior:
 *   - if `emailsToUpdate` provided, removes those emails from `sharedWith` on matching documents
 *   - applies `updateQuery` to UserFile and Directory documents under `parentId`
 *   - recurses into sub-directories until `maxDepth` is reached
 * returns: Promise<void>
 */
export const shareDirectoryRecursive = async (
  parentId,
  session,
  emailsToUpdate,
  updateQuery,
  depth = 0,
) => {
  if (depth > maxDepth) return;

  if (emailsToUpdate.length > 0) {
    await UserFile.updateMany(
      { parentId, isDeleted: false },
      { $pull: { sharedWith: { email: { $in: emailsToUpdate } } } },
      { session },
    );

    await Directory.updateMany(
      { parentId, isDeleted: false },
      { $pull: { sharedWith: { email: { $in: emailsToUpdate } } } },
      { session },
    );
  }

  if (updateQuery) {
    await UserFile.updateMany({ parentId, isDeleted: false }, updateQuery, {
      session,
    });
    await Directory.updateMany({ parentId, isDeleted: false }, updateQuery, {
      session,
    });
  }

  if (depth === maxDepth) return;

  const children = await Directory.find({ parentId, isDeleted: false })
    .select("_id")
    .session(session);

  for (const child of children) {
    await shareDirectoryRecursive(
      child._id,
      session,
      emailsToUpdate,
      updateQuery,
      depth + 1,
    );
  }
};
