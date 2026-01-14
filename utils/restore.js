import { ObjectId } from "mongodb";
import Directory from "../models/directory.model.js";
import FileModel from "../models/file.model.js";

let dummyParent = null;
//helper
const getDummyParent = (item, userId) => ({
  _id: item.parentId,
  name: "restored folder",
  parentId: null,
  userId,
  isDeleted: false,
  deletedBy: "",
  deletedAt: null,
});

/* Restore parent chain (bottom to root) */
const restoreParentChain = async (userId, item, visited) => {
  try {
    if (!item.parentId) return;

    const pid = item.parentId.toString();
    if (visited.has(pid)) return;
    visited.add(pid);

    const parent = await Directory.findOne({
      _id: item.parentId,
      userId,
      isDeleted: false,
    });

    if (parent) return;

    const binParent = await Directory.findOne({
      _id: item.parentId,
      userId,
      isDeleted: true,
    });

    if (binParent) {
      await restoreParentChain(userId, binParent, visited);

      await Directory.updateOne(
        { _id: binParent._id },
        {
          $set: {
            isDeleted: false,
            updatedAt: new Date(),
            deletedBy:
              binParent.deletedBy === "process" ? "" : binParent.deletedBy,
          },
        }
      );
      return;
    }

    //create dummy parent for missing parent
    const dummy = await Directory.updateOne(
      { _id: item.parentId, userId },
      { $setOnInsert: getDummyParent(item, userId, deletedItemParent) },
      { upsert: true }
    );

    dummyParent = dummy;
  } catch (err) {
    throw err;
  }
};

/* Restore files under a directory */
const restoreFiles = async (userId, dirId) => {
  try {
    await FileModel.updateMany(
      {
        parentId: dirId,
        userId,
        isDeleted: true,
        deletedBy: "process", //only deletedby process
      },
      {
        $set: {
          isDeleted: false,
          deletedBy: "",
          updatedAt: new Date(),
        },
      }
    );
  } catch (err) {
    throw err;
  }
};

/* Restore directories recursively (DFS) */
const restoreDirsRecursive = async (userId, dirId) => {
  try {
    const children = await Directory.find(
      {
        parentId: dirId,
        userId,
        isDeleted: true,
        deletedBy: "process",
      },
      { _id: 1 }
    ).lean();

    for (const child of children) {
      await Directory.updateOne(
        { _id: child._id },
        {
          $set: {
            isDeleted: false,
            deletedBy: "",
            updatedAt: new Date(),
          },
        }
      );

      await restoreDirsRecursive(userId, child._id);
      await restoreFiles(userId, child._id);
    }
  } catch (err) {
    throw err;
  }
};

const restoreFile = async (userId, file) => {
  const visited = new Set();

  try {
    await restoreParentChain(userId, file, visited);

    await FileModel.updateOne(
      { _id: file._id },
      {
        $set: {
          isDeleted: false,
          deletedBy: "",
          updatedAt: new Date(),
        },
      }
    );
    return dummyParent;
  } catch (err) {
    throw err;
  }
};

const restoreDirectory = async (userId, dir) => {
  const visited = new Set();

  try {
    // 1. restore parent chain
    await restoreParentChain(userId, dir, visited);

    // 2. restore this directory
    await Directory.updateOne(
      { _id: dir._id },
      {
        $set: {
          isDeleted: false,
          deletedBy: "",
          updatedAt: new Date(),
        },
      }
    );

    // 3. restore subtree
    await restoreDirsRecursive(userId, dir._id);
    await restoreFiles(userId, dir._id);

    return dummyParent;
  } catch (err) {
    throw err;
  }
};

export { restoreFile, restoreDirectory };
