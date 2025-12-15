import { ObjectId } from "mongodb";

//helper
const getDummyParent = (item, userId) => ({
  _id: item.parentId,
  name: "restored folder",
  parentId: null,
  userId,
  deletedBy: "",
  isDeleted: false,
  createdAt: new Date(),
  modifiedAt: new Date(),
});

/* Restore parent chain (bottom to root) */
const restoreParentChain = async (db, userId, item, visited) => {
  try {
    if (!item.parentId) return;

    const pid = item.parentId.toString();
    if (visited.has(pid)) return;
    visited.add(pid);

    const parent = await db.collection("directories").findOne({
      _id: item.parentId,
      userId,
      isDeleted: false,
    });

    if (parent) return;

    const deletedParent = await db.collection("directories").findOne({
      _id: item.parentId,
      userId,
      isDeleted: true,
    });

    if (deletedParent) {
      await restoreParentChain(db, userId, deletedParent, visited);

      await db.collection("directories").updateOne(
        { _id: deletedParent._id },
        {
          $set: {
            isDeleted: false,
            modifiedAt: new Date(),
            deletedBy:
              deletedParent.deletedBy === "process"
                ? ""
                : deletedParent.deletedBy,
          },
        }
      );
      return;
    }

    //create dummy parent for missing parent
    const dummy = await db
      .collection("directories")
      .updateOne(
        { _id: item.parentId, userId },
        { $setOnInsert: getDummyParent(item, userId) },
        { upsert: true }
      );
    console.log(dummy);
  } catch (err) {
    throw err;
  }
};

/* Restore files under a directory */
const restoreFiles = async (db, userId, dirId) => {
  try {
    await db.collection("files").updateMany(
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
          modifiedAt: new Date(),
        },
      }
    );
  } catch (err) {
    throw err;
  }
};

/* Restore directories recursively (DFS) */
const restoreDirsRecursive = async (db, userId, dirId) => {
  try {
    const children = await db
      .collection("directories")
      .find(
        {
          parentId: dirId,
          userId,
          isDeleted: true,
          deletedBy: "process",
        },
        { projection: { _id: 1 } }
      )
      .toArray();

    for (const child of children) {
      await db.collection("directories").updateOne(
        { _id: child._id },
        {
          $set: {
            isDeleted: false,
            deletedBy: "",
            modifiedAt: new Date(),
          },
        }
      );

      await restoreDirsRecursive(db, userId, child._id);
      await restoreFiles(db, userId, child._id);
    }
  } catch (err) {
    throw err;
  }
};

/* public APIs */

const restoreFile = async (db, userId, file) => {
  const visited = new Set();

  try {
    await restoreParentChain(db, userId, file, visited);

    await db.collection("files").updateOne(
      { _id: file._id },
      {
        $set: {
          isDeleted: false,
          deletedBy: "",
          modifiedAt: new Date(),
        },
      }
    );
  } catch (err) {
    throw err;
  }
};

const restoreDirectory = async (db, userId, dir) => {
  const visited = new Set();

  try {
    // 1. restore parent chain
    await restoreParentChain(db, userId, dir, visited);

    // 2. restore this directory
    await db.collection("directories").updateOne(
      { _id: dir._id },
      {
        $set: {
          isDeleted: false,
          deletedBy: "",
          modifiedAt: new Date(),
        },
      }
    );

    // 3. restore subtree
    await restoreDirsRecursive(db, userId, dir._id);
    await restoreFiles(db, userId, dir._id);
  } catch (err) {
    throw err;
  }
};

export { restoreFile, restoreDirectory };
