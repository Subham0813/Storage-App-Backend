import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

let dummyParent = null;
let rootDirId = null;
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
const restoreParentChain = async (userId, item, visited) => {
  try {
    const pid = item.parentId.toString();
    if (visited.has(pid)) return;
    visited.add(pid);

    const parent = await Directory.findById(item.parentId);
    if (!parent) {
      //create dummy parent for missing parent
      const dummy = await Directory.findOneAndUpdate(
        { _id: item.parentId, userId },
        {
          $setOnInsert: getDummyParent(item, userId, rootDirId),
        },
        { upsert: true },
      );
    } else if (parent.isDeleted) {
      await restoreParentChain(userId, parent, visited);

      await Directory.findOneAndUpdate(
        { _id: parent._id },
        {
          $set: {
            isDeleted: false,
            updatedAt: new Date(),
            deletedBy:
              parent.deletedBy === "process" ? "none" : parent.deletedBy,
          },
        },
        { new: true },
      );
    }
  } catch (err) {
    throw err;
  }
};

/* Restore files under a directory */
const restoreFiles = async (dir) => {
  try {
    await UserFile.updateMany(
      {
        parentId: dir._id,
        isDeleted: true,
        deletedBy: "process", //only deletedby process
      },
      {
        $set: {
          isDeleted: false,
          deletedBy: "none",
          updatedAt: new Date(),
        },
      },
    );
  } catch (err) {
    throw err;
  }
};

/* Restore directories recursively (DFS) */
const restoreDirsRecursive = async (dir) => {
  try {
    const children = await Directory.find({
      parentId: dir._id,
      isDeleted: true,
      deletedBy: "process",
    });
    for (let child of children) {
      child = await Directory.findOneAndUpdate(
        { _id: child._id },
        {
          $set: {
            isDeleted: false,
            deletedBy: "none",
            updatedAt: new Date(),
          },
        },
      );

      await restoreDirsRecursive(child);
      await restoreFiles(child);
    }
  } catch (err) {
    throw err;
  }
};

export const restoreFile = async (userId, file, rootId) => {
  const visited = new Set();
  rootDirId = rootId;
  try {
    await restoreParentChain(userId, file, visited);
  } catch (err) {
    throw err;
  }
};

export const restoreDirectory = async (userId, dir, rootId) => {
  const visited = new Set();
  rootDirId = rootId;

  try {
    // 1. restore parent chain
    await restoreParentChain(userId, dir, visited);

    // 2. restore subtree
    await restoreDirsRecursive(userId, dir);
    await restoreFiles(userId, dir._id);

    return true;
  } catch (err) {
    throw err;
  }
};
