import mongoose from "mongoose";
import path from "path";
import { unlink } from "fs/promises";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { File as FileModel } from "../models/file.model.js";

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

export const recursiveRemove = async (dir, visited) => {
  try {
    if (visited.has(dir._id.toString())) return;
    visited.add(dir._id.toString());

    // 1. soft-delete files
    await UserFile.updateMany(
      {
        parentId: dir._id,
        isDeleted: false,
      },
      {
        $set: {
          isDeleted: true,
          deletedBy: "process",
          updatedAt: new Date(),
          deletedAt: new Date(),
        },
      },
    );

    const children = await Directory.find({
      parentId: dir._id,
      isDeleted: false,
    });

    // 2. depth-first delete child
    for (const child of children) {
      await recursiveRemove(child, visited);

      await Directory.findOneAndUpdate(
        { _id: child._id },
        {
          $set: {
            isDeleted: true,
            deletedBy: "process",
            updatedAt: new Date(),
            deletedAt: new Date(),
          },
        },
      );
    }
  } catch (err) {
    throw err;
  }
};

export const recursiveDelete = async (dir, visited) => {
  try {
    if (visited.has(dir._id.toString())) return;
    visited.add(dir._id.toString());

    // 1. unlink all files from storage & delete info from Db
    const files = await UserFile.find({ parentId: dir._id })
      .populate({ path: "meta", select: "objectKey" })
      .lean();

    // console.info(files);

    for (const file of files) {
      const del = await UserFile.deleteOne({ _id: file._id });
      const updt = await FileModel.findOneAndUpdate(
        { _id: file.meta._id, refCount: { $gt: 0 } },
        { $inc: { refCount: -1 } },
      );

      // console.info({ del, updt });

      if (updt && updt.refCount < 1) {
        //delete from db
        await FileModel.deleteOne({ _id: updt._id });

        //delete  from local
        const absolutePath = path.join(
          path.resolve(UPLOAD_ROOT),
          file.meta.objectKey,
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

    const children = await Directory.find({ parentId: dir._id });

    // 2. depth-first delete child
    for (const child of children) {
      await recursiveDelete(child, visited);

      await Directory.deleteOne({ _id: child._id });
    }
  } catch (err) {
    throw err;
  }
};
