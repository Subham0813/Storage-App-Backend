import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

// Soft-delete all descendants of dirId
export const recursiveRemove = async (dirId, session, permanentDeleteAt) => {
  const deletedFields = {
    isDeleted: true,
    deletedBy: "process",
    deletedAt: new Date(),
    permanentDeleteAt,
  };

  await Promise.all([
    Directory.updateMany(
      { path: dirId, isDeleted: false },
      { $set: deletedFields },
      { session },
    ),
    UserFile.updateMany(
      { path: dirId, isDeleted: false },
      { $set: deletedFields },
      { session },
    ),
  ]);
};

// Permanently delete all descendants of dirId
export const recursiveDelete = async (
  dirId,
  session,
  s3KeysToDelete = [],
  s3ThumbnailsToDelete = [],
) => {
  const files = await UserFile.find({ path: dirId })
    .select("_id key versionId thumbnailKey thumbId size")
    .session(session)
    .lean();
  const fileIds = files.map((f) => f._id);

  const uniqueKeys = new Map();
  const uniqueThumbs = new Map();
  for (const file of files) {
    if (file.key && !uniqueKeys.has(file.key))
      uniqueKeys.set(file.key, { key: file.key, id: file.versionId });
    if (file.thumbnailKey && !uniqueThumbs.has(file.thumbnailKey))
      uniqueThumbs.set(file.thumbnailKey, {
        key: file.thumbnailKey,
        id: file.thumbId,
      });
  }

  const keysToCheck = Array.from(uniqueKeys.keys());
  const thumbsToCheck = Array.from(uniqueThumbs.keys());

  const [otherFilesWithKeys, otherFilesWithThumbs] = await Promise.all([
    keysToCheck.length > 0
      ? UserFile.find({
          key: { $in: keysToCheck },
          _id: { $nin: fileIds },
        })
          .select("key")
          .session(session)
          .lean()
      : Promise.resolve([]),
    thumbsToCheck.length > 0
      ? UserFile.find({
          thumbnailKey: { $in: thumbsToCheck },
          _id: { $nin: fileIds },
        })
          .select("thumbnailKey")
          .session(session)
          .lean()
      : Promise.resolve([]),
  ]);

  const keysWithOtherCopies = new Set(otherFilesWithKeys.map((f) => f.key));
  const thumbsWithOtherCopies = new Set(
    otherFilesWithThumbs.map((f) => f.thumbnailKey),
  );

  for (const key of keysToCheck) {
    if (!keysWithOtherCopies.has(key)) s3KeysToDelete.push(uniqueKeys.get(key));
  }
  for (const key of thumbsToCheck) {
    if (!thumbsWithOtherCopies.has(key))
      s3ThumbnailsToDelete.push(uniqueThumbs.get(key));
  }

  // sum all file sizes under this dir
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

  // decrement path of dirId itself
  if (totalSize > 0) {
    const dir = await Directory.findById(dirId)
      .select("path")
      .session(session)
      .lean();

    if (dir) {
      const path = [...dir.path, dirId];
      await Directory.updateMany(
        { _id: { $in: path } },
        { $inc: { size: -totalSize } },
        { session },
      );
    }
  }

  await Promise.all([
    Directory.deleteMany({ path: dirId }).session(session),
    UserFile.deleteMany({ path: dirId }).session(session),
  ]);

  return { s3KeysToDelete, s3ThumbnailsToDelete };
};
