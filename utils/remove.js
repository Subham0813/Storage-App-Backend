import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

// Soft-delete all descendants of dirId
export const recursiveRemove = async (dirId, session) => {
  const deletedFields = {
    isDeleted: true,
    deletedBy: "process",
    deletedAt: new Date(),
  };

  await Promise.all([
    Directory.updateMany(
      { ancestors: dirId, isDeleted: false },
      { $set: deletedFields },
      { session },
    ),
    UserFile.updateMany(
      { ancestors: dirId, isDeleted: false },
      { $set: deletedFields },
      { session },
    ),
  ]);
};

// Permanently delete all descendants of dirId
export const recursiveDelete = async (dirId, session, s3KeysToDelete) => {
  const files = await UserFile.find({ ancestors: dirId })
    .select("key size")
    .session(session)
    .lean();

  for (const file of files) {
    if (file.key) s3KeysToDelete.push(file.key);
  }

  // sum all file sizes under this dir
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);

  // decrement ancestors of dirId itself
  if (totalSize > 0) {
    const dir = await Directory.findById(dirId)
      .select("ancestors")
      .session(session)
      .lean();

    if (dir && dir.ancestors.length > 0) {
      await Directory.updateMany(
        { _id: { $in: dir.ancestors } },
        { $inc: { size: -totalSize } },
        { session },
      );
    }
  }

  await Promise.all([
    Directory.deleteMany({ ancestors: dirId }).session(session),
    UserFile.deleteMany({ ancestors: dirId }).session(session),
  ]);
};
