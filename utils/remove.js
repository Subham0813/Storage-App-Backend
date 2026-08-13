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
export const recursiveDelete = async (dirId, session, s3KeysToDelete = []) => {
  const files = await UserFile.find({ path: dirId })
    .select("_id key size")
    .session(session)
    .lean();
  const fileIds = files.map((f) => f._id);
  const uniqueKeys = new Set();
  for (const file of files) {
    if (file.key) {
      uniqueKeys.add(file.key);
    }
  }

  const keysToCheck = Array.from(uniqueKeys);
  const otherFilesWithKeys = await UserFile.find({
    key: { $in: keysToCheck },
    _id: { $nin: fileIds },
  })
    .select("key")
    .session(session)
    .lean();

  const keysWithOtherCopies = new Set(otherFilesWithKeys.map((f) => f.key));

  for (const key of keysToCheck) {
    if (!keysWithOtherCopies.has(key)) {
      s3KeysToDelete.push({ key });
    }
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

  return s3KeysToDelete;
};
