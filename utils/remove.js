import { ObjectId } from "mongodb";

const recursiveRemove = async (
  db,
  dirId,
  userId,
  visited = new Set(),
  result = new Map()
) => {
  try {
    if (!dirId || visited.has(dirId)) return null;
    visited.add(dirId);

    //all files of the directory should be deleted
    const fileUpdate = await db.collection("files").updateMany(
      { parentId: dirId, userId: userId, isDeleted: false },
      {
        $set: {
          isDeleted: true,
          modifiedAt: new Date().toISOString(),
          deletedBy: "process",
        },
      }
    );

    //all child-directories of the directory should be deleted
    const children = await db
      .collection("directories")
      .find(
        { parentId: dirId, userId: userId, isDeleted: false },
        {
          projection: {
            _id: 1,
          },
        }
      )
      .toArray();

    const dirUpdt = new Map();

    for (const child of children) {
      const recRm = await recursiveRemove(
        db,
        child._id,
        userId,
        visited,
        result
      );
      const updt = await db.collection("directories").updateOne(
        { _id: child._id },
        {
          $set: {
            isDeleted: true,
            modifiedAt: new Date().toISOString(),
            deletedBy: "process",
          },
        }
      );
      dirUpdt.set(child._id, { recrm: recRm, updt: updt });
    }
    result.set(dirId, { fileUpdate: fileUpdate, dirUpdt: dirUpdt });
    return result;
  } catch (error) {
    console.log({ error });
    return error;
  }
};

export { recursiveRemove };
