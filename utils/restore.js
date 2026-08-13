import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

// Restore all descendants of dirId that were soft-deleted by process
export const restoreDescendants = async (dirId, session) => {
  const restoredFields = {
    isDeleted: false,
    deletedBy: "none",
    deletedAt: null,
    permanentDeleteAt: null,
  };

  await Promise.all([
    Directory.updateMany(
      { path: dirId, deletedBy: "process" },
      { $set: restoredFields },
      { session },
    ),
    UserFile.updateMany(
      { path: dirId, deletedBy: "process" },
      { $set: restoredFields },
      { session },
    ),
  ]);
};
