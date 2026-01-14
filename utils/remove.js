import { unlink } from "fs/promises";
import { ObjectId } from "mongodb";
import path from "path";

import Directory from "../models/directory.model.js";
import FileModel from "../models/file.model.js";

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

const recursiveRemove = async (dirId, userId, visited) => {
  try {
    if (!ObjectId.isValid(dirId)) return;
    if (visited.has(dirId.toString())) return;

    visited.add(dirId.toString());

    // 1. soft-delete files
    await FileModel.updateMany(
      {
        parentId: dirId,
        userId,
        isDeleted: false,
      },
      {
        $set: {
          isDeleted: true,
          deletedBy: "process",
          updatedAt: new Date(),
        },
      }
    );

    // 2. get children directories
    const children = await Directory.find(
      { parentId: dirId, userId, isDeleted: false },
      { _id: 1 }
    ).lean();

    // 3. depth-first delete
    for (const child of children) {
      await recursiveRemove(child._id, userId, visited);

      await Directory.updateOne(
        { _id: child._id },
        {
          $set: {
            isDeleted: true,
            deletedBy: "process",
            updatedAt: new Date(),
            deletedAt: new Date(),
          },
        }
      );
    }
  } catch (err) {
    throw err;
  }
};

const recursiveDelete = async (dirId, userId, visited) => {
  try {
    if (!ObjectId.isValid(dirId)) return;
    if (visited.has(dirId.toString())) return;

    visited.add(dirId.toString());

    // 1. unlink all files from storage & delete info from Db
    const files = await FileModel.find(
      { parentId: dirId, userId, deletedBy: { $in: ["", "process"] } },
      { objectKey: 1 }
    ).lean();

    for (const file of files) {
      const absolutePath = path.join(path.resolve(UPLOAD_ROOT), file.objectKey);

      if (!absolutePath.startsWith(path.resolve(UPLOAD_ROOT))) {
        console.log(
          "Error: ",
          "Invalid path / file not exists in local ",
          !absolutePath.startsWith(path.resolve(UPLOAD_ROOT))
        );

        return new Error("Error occured during execution!");
      }

      try {
        await unlink(absolutePath);
        console.log("File deleted from local..");
      } catch (err) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }

      await FileModel.deleteOne({ _id: file._id });
    }

    // 2. get children
    const children = await Directory.find(
      { parentId: dirId, userId, deletedBy: { $in: ["", "process"] } },
      {  _id: 1 } 
    ).lean();

    // 3. depth-first delete
    for (const child of children) {
      await recursiveDelete(child._id, userId, visited);

      await Directory.deleteOne({ _id: child._id });
    }
  } catch (err) {
    throw err;
  }
};

export { recursiveRemove, recursiveDelete };
 