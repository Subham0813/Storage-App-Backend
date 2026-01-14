import mongoose from "mongoose";
import path from "path";
import { unlink } from "fs/promises";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { File as FileModel } from "../models/file.model.js";

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

const recursiveRemove = async (dirId, userId, visited) => {
  try {
    if (!mongoose.isValidObjectId(dirId)) return;
    if (visited.has(dirId.toString())) return;

    visited.add(dirId.toString());

    // 1. soft-delete files
    await UserFile.updateMany(
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
          deletedAt: new Date(),
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
    if (!mongoose.isValidObjectId(dirId)) return;
    if (visited.has(dirId.toString())) return;

    visited.add(dirId.toString());

    // 1. unlink all files from storage & delete info from Db
    const files = await UserFile.find({ parentId: dirId, userId: userId })
      .populate({ path: "meta", select: "objectKey" })
      .lean();

    // console.info(files);

    for (const file of files) {
      const del = await UserFile.deleteOne({ _id: file._id });
      const updt = await FileModel.findOneAndUpdate(
        { _id: file.meta._id, refCount: { $gt: 0 } },
        { $inc: { refCount: -1 } }
      );

      // console.info({ del, updt });

      if (updt && updt.refCount < 1) {
        //delete from db
        await FileModel.deleteOne({ _id: updt._id });

        //delete  from local
        const absolutePath = path.join(
          path.resolve(UPLOAD_ROOT),
          file.meta.objectKey
        );

        try {
          await unlink(absolutePath);
          console.info(`${file.name} file unlinked.`);
        } catch (err) {
          if (err.code !== "ENOENT") {
            throw err;
          }
        }
      }
    }

    // 2. get children
    const children = await Directory.find(
      { parentId: dirId, userId },
      { _id: 1 }
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
