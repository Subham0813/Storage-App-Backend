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

// Permanently delete all descendants of dirId.
// dirPath    : ancestor chain of dirId ([root, ...]) — captured BEFORE the directory document itself is removed.
// wasTrashed : true when dirId was soft-deleted, false for a live directory (not deleted yet).
export const recursiveDelete = async (
  dirId,
  session,
  s3KeysToDelete = [],
  s3ThumbnailsToDelete = [],
  dirPath = [],
  wasTrashed = true,
) => {
  const files = await UserFile.find({ path: dirId })
    .select("_id key versionId thumbnailKey thumbId size isDeleted")
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
  const allSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const liveSize = files.reduce(
    (sum, f) => sum + (f.isDeleted ? 0 : f.size || 0),
    0,
  );

  if (allSize > 0) {
    const rootId = dirPath.length > 0 ? dirPath[0] : null;

    if (rootId) {
      // Root still counts every byte (live + trashed) of the subtree — it is
      // always released. Clamp so a stray stored value can't go negative.
      await Directory.updateOne(
        { _id: rootId },
        [{ $set: { size: { $max: [0, { $subtract: ["$size", allSize] }] } } }],
        { session, updatePipeline: true },
      );
    }

    // A live directory is still counted by its non-root ancestors; a trashed
    // one was already de-counted at moveToBin( path.slice(1) ).
    const ancestorDirsToDebit = wasTrashed ? [] : dirPath.slice(1);
    if (liveSize > 0 && ancestorDirsToDebit.length > 0) {
      await Directory.updateMany(
        { _id: { $in: ancestorDirsToDebit } },
        [{ $set: { size: { $max: [0, { $subtract: ["$size", liveSize] }] } } }],
        { session, updatePipeline: true },
      );
    }
  }

  await Promise.all([
    Directory.deleteMany({ path: dirId }).session(session),
    UserFile.deleteMany({ path: dirId }).session(session),
  ]);

  return { s3KeysToDelete, s3ThumbnailsToDelete };
};
