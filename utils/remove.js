import { unlink } from "fs/promises";
import { ObjectId } from "mongodb";
import path from "path";

const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.resolve(process.cwd() +"/uploads");

const recursiveRemove = async (db, dirId, userId, visited) => {
  try {
    if (!ObjectId.isValid(dirId)) return;
    if (visited.has(dirId.toString())) return;

    visited.add(dirId.toString());

    // 1. soft-delete files
    await db.collection("files").updateMany(
      {
        parentId: dirId,
        userId,
        isDeleted: false,
      },
      {
        $set: {
          isDeleted: true,
          deletedBy: "process",
          modifiedAt: new Date(),
        },
      }
    );

    // 2. get children directories
    const children = await db
      .collection("directories")
      .find(
        { parentId: dirId, userId, isDeleted: false },
        { projection: { _id: 1 } }
      )
      .toArray();

    // const dirResults = new Map();

    // 3. depth-first delete
    for (const child of children) {
      await recursiveRemove(db, child._id, userId, visited);

      await db.collection("directories").updateOne(
        { _id: child._id },
        {
          $set: {
            isDeleted: true,
            deletedBy: "process",
            modifiedAt: new Date(),
          },
        }
      );

      // dirResults.set(child._id.toString(), updt);
    }

    // result.set(dirId.toString(), {
    //   fileUpdate,
    //   dirResults,
    // });
  } catch (err) {
    throw err;
  }
};

const recursiveDelete = async (db, dirId, userId, visited) => {
  try {
    if (!ObjectId.isValid(dirId)) return;
    if (visited.has(dirId.toString())) return;

    visited.add(dirId.toString());

    // 1. unlink all files from storage & delete info from Db
    const files = await db
      .collection("files")
      .find(
        { parentId: dirId, userId },
        { projection: { objectKey: 1 } }
      )
      .toArray();

    for (const file of files) {
      
      const absolutePath = path.join(path.resolve(UPLOAD_ROOT), file.objectKey);

      if (!absolutePath.startsWith(path.resolve(UPLOAD_ROOT))) {
        console.log(
          "Error: ",
          "Invalid path / file not exists in local ",
          !absolutePath.startsWith(path.resolve(UPLOAD_ROOT))
        );

        return next("Error occured during execution!!");
      }

      try {
        await unlink(absolutePath);
        console.log('File deleted from local..')
      } catch (err) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }

      await db.collection("files").deleteOne({
        _id: file._id,
      });
    }

    // 2. get children
    const children = await db
      .collection("directories")
      .find(
        { parentId: dirId, userId},
        { projection: { _id: 1 } }
      )
      .toArray();

    // const dirResults = new Map();

    // 3. depth-first delete
    for (const child of children) {
      await recursiveDelete(db, child._id, userId, visited);

      await db.collection("directories").deleteOne({ _id: child._id });
    }
  } catch (err) {
    throw err;
  }
};

export { recursiveRemove, recursiveDelete };
