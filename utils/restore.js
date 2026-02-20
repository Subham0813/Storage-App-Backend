import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

let dummyParent = null;
let rootDirId = null;

/**
 * Helper: getDummyParent
 * what it do: Create a placeholder directory structure when parent directory is missing after restore.
 * requirements:
 *   - item: file or directory being restored
 *   - userId: owner user ObjectId
 *   - rootDirId: user's root directory id to link orphaned items
 */
//helper
const getDummyParent = (item, userId, rootDirId) => ({
  _id: item.parentId,
  name: "restored folder",
  parentId: rootDirId,
  userId,
  isDeleted: false,
  deletedBy: "none",
  deletedAt: null,
});

/* Restore parent chain (bottom to root) */
/**
 * Helper: restoreParentChain
 * what it do: Recursively restore parent directories from bottom to root when an item is restored.
 * requirements:
 *   - userId: owner user ObjectId
 *   - item: file or directory being restored
 *   - visited: Set to prevent re-processing
 *   - Creates dummy parents if missing, restores deleted parents up the chain
 */
const restoreParentChain = async (userId, item, visited) => {
  try {
    const pid = item.parentId.toString();
    if (visited.has(pid)) return;
    visited.add(pid);

    const parent = await Directory.findById(item.parentId);
    if (!parent) {
      //create dummy parent for missing parent
      dummyParent = await Directory.findOneAndUpdate(
        { _id: item.parentId, userId },
        {
          $setOnInsert: getDummyParent(item, userId, rootDirId),
        },
        { upsert: true },
      );
      return;
    } else if (parent.isDeleted) {
      await restoreParentChain(userId, parent, visited);

      await Directory.findByIdAndUpdate(parent._id, {
        $set: {
          isDeleted: false,
          deletedBy: parent.deletedBy === "process" ? "none" : parent.deletedBy,
        },
      });
    }
  } catch (err) {
    throw err;
  }
};

/* Restore files under a directory */
/**
 * Helper: restoreChildFiles
 * what it do: Restore all files soft-deleted by the process (not by user) under a directory.
 * requirements:
 *   - dir: Directory document
 *   - Marks isDeleted=false, deletedBy='none' for files with deletedBy='process'
 */
export const restoreChildFiles = async (parentId, session) => {
  try {
    await UserFile.updateMany(
      { parentId, isDeleted: true, deletedBy: "process" },
      { $set: { isDeleted: false, deletedBy: "none", deletedAt: null } },
      { session },
    );
  } catch (err) {
    throw err;
  }
};

/* Restore directories recursively (DFS) */
/**
 * Helper: restoreChildDirectories
 * what it do: Recursively restore child directories and their files using depth-first traversal.
 * requirements:
 *   - dir: Directory document
 *   - Restores directories with deletedBy='process' and restores their files
 */
export const restoreChildDirectories = async (parentId, session) => {
  try {
    const children = await Directory.find({
      parentId,
      isDeleted: true,
      deletedBy: "process",
    })
      .select("_id")
      .session(session);

    await Directory.updateMany(
      { parentId, isDeleted: true, deletedBy: "process" },
      { $set: { isDeleted: false, deletedBy: "none", deletedAt: null } },
      { session },
    );

    for (const child of children) {
      await restoreChildFiles(child._id, session);
      await restoreChildDirectories(child._id, session);
    }
  } catch (err) {
    throw err;
  }
};

/**
 * Utility: restoreFileParent
 * what it do: Restore a file's parent directory chain when the file is restored.
 * requirements:
 *   - userId: owner user ObjectId
 *   - file: UserFile document being restored
 *   - rootId: user's root directory id
 *   - Returns: dummyParent if created, otherwise void
 */
export const restoreFileParent = async (userId, file, rootId) => {
  const visited = new Set();
  rootDirId = rootId;
  try {
    await restoreParentChain(userId, file, visited);
    return dummyParent;
  } catch (err) {
    throw err;
  }
};

/**
 * Utility: restoreDirectory
 * what it do: Restore a soft-deleted directory and its entire subtree (files and subdirectories).
 * requirements:
 *   - userId: owner user ObjectId
 *   - dir: Directory document being restored
 *   - rootId: user's root directory id
 *   - Restores parent chain, then recursively restores all children
 */
export const restoreDirectory = async (userId, dirId, rootId) => {
  const visited = new Set();
  rootDirId = rootId;
  try {
    // 1. restore parent chain
    await restoreParentChain(userId, dirId, visited);

    // 2. restore subtree
    await restoreChildDirectories(dirId);
    await restoreChildFiles(dirId);

    // return dummyParent;
  } catch (err) {
    throw err;
  }
};
