const getDummyParent = (item, userId) => {
  const dummy = {
    _id: item.parentId,
    name: `${item.parentName}-restored`,
    parentId: null,
    parentName: "",
    userId,
    deletedBy: "",
    isDeleted: false,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
  return dummy;
};

const restoreParentHelper = async (db, userId, item, visited, type = "dir") => {
  try {
    if (visited.has(item.parentId) || item.parentId === null) return;
    visited.add(item.parentId);

    const parent = await db
      .collection("directories")
      .findOne({ _id: item.parentId, userId: userId, isDeleted: false });

    if (parent) return;

    const deletedParent = await db.collection("directories").findOne({
      _id: item.parentId,
      userId: userId,
      isDeleted: true,
    });

    if (deletedParent) {
      await restoreParentHelper(db, userId, deletedParent, visited);

      await db.collection("directories").updateOne({ _id: deletedParent._id }, [
        {
          $set: {
            isDeleted: false,
            modifiedAt: new Date().toISOString(),
            deletedBy: {
              $cond: [
                { $eq: ["$deletedBy", "process"] }, // IF deletedBy == "process"
                "", // THEN set ""
                "$deletedBy", // ELSE keep existing value
              ],
            },
          },
        },
      ]);
    } else {
      const parentDummy = getDummyParent(item, userId);

      const { insertedId: parentId } = await db
        .collection("directories")
        .insertOne(parentDummy);

      // if (type === "file")
      //   await db
      //     .collection("files")
      //     .updateOne({ _id: item._id }, { $set: { parentId: parentId } });
      // else
      //   await db
      //     .collection("directories")
      //     .updateOne({ _id: item._id }, { $set: { parentId: parentId } });
    }
  } catch (error) {
    return error;
  }
};

const restoreChildrenFilesHelper = async (db, userId, dir) => {
  try {
    const files = await db //1. get all the files and modify of the dir [not deleted by user]
      .collection("files")
      .find(
        {
          parentId: dir._id,
          userId: userId,
          isDeleted: true,
          deletedBy: { $ne: "user" },
          // $or: [
          //   { deletedBy: { $exists: false } }, //deletedBy property doesn't exists at all -> $exists
          //   { deletedBy: { $ne: "user" } }, //deletedBy not equals to "user" -> $ne
          // ],
        },
        { projection: { _id: 1 } }
      )
      .toArray();

    for (const file of files) {
      await db.collection("files").updateOne(
        { _id: file._id },
        {
          $set: {
            deletedBy: "",
            isDeleted: false,
            modifiedAt: new Date().toISOString(),
          },
        }
      );
    }
  } catch (error) {
    return error;
  }
};

const restoreChildrenDirsHelper = async (db, userId, dir) => {
  try {
    const dirs = await db //2. get all the chDirs and modify of the parentDir [not deleted by user]
      .collection("directories")
      .find(
        {
          parentId: dir._id,
          userId,
          isDeleted: true,
          deletedBy: { $ne: "user" },
          // $or: [
          //   { deletedBy: { $exists: false } }, //deletedBy propertt doesn't exists at all -> $exists
          //   { deletedBy: { $ne: "user" } }, //deletedBy not equals to "user" -> $ne
          // ],
        },
        {
          projection: {
            _id: 1,
            name: 1,
            parentId: 1,
            parentName: 1,
          },
        }
      )
      .toArray();

    for (const child of dirs) {
      await restoreDirectory(db, userId, child);

      await db.collection("directories").updateOne(
        { _id: child._id },
        {
          $set: {
            deletedBy: "",
            isDeleted: false,
            modifiedAt: new Date().toISOString(),
          },
        }
      );
    }
  } catch (error) {
    return error;
  }
};

const restoreFile = async (db, userId, file) => {
  try {
    const visited = new Set();
    return await Promise.all([
      await restoreParentHelper(db, userId, file, visited, "file"), //1. search & bring back its parent
      await db.collection("files").updateOne(
        { _id: file._id }, //2. filesDb update
        {
          $set: {
            isDeleted: false,
            deletedBy: "",
            modifiedAt: new Date().toISOString(),
          },
        }
      ),
    ]);
  } catch (error) {
    console.log(error);
    return error;
  }
};

const restoreDirectory = async (db, userId, dir) => {
  try {
    const visited = new Set();
    return await Promise.all([
      await restoreParentHelper(db, userId, dir, visited, "dir"), //1. search & bring back its parent
      await db.collection("directories").updateOne(
        { _id: dir._id }, //2. dir update
        {
          $set: {
            isDeleted: false,
            deletedBy: "",
            modifiedAt: new Date().toISOString(),
          },
        }
      ),
      await restoreChildrenFilesHelper(db, userId, dir), //4. child files restore
      await restoreChildrenDirsHelper(db, userId, dir), //3. child dirs restore (recursive)
    ]);
  } catch (error) {
    return error;
  }
};

export { restoreFile, restoreDirectory };
