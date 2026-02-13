import path from "path";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { File as FileModel } from "../models/file.model.js";

const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

/**
 * Utility: recursiveRemove
 * what it do: Soft-delete a directory and all its contents (files and subdirectories) recursively using DFS.
 * requirements:
 *   - dir: Directory document to soft-delete
 *   - visited: Set to track visited directories and prevent cycles
 *   - Marks isDeleted=true, deletedBy='process' on all descendants
 */
export const recursiveRemove = async (dirId, session, visited) => {
  if (visited.has(dirId.toString())) return;
  visited.add(dirId.toString());

  try {
    const children = await Directory.find({
      parentId: dirId,
      isDeleted: false,
    });

    // soft-delete files
    await UserFile.updateMany(
      { parentId: dirId, isDeleted: false },
      {
        $set: {
          isDeleted: true,
          deletedBy: "process",
          deletedAt: new Date(),
        },
      },
      { session },
    );

    // soft-delete children
    if (children.length > 0) {
      await Directory.updateMany(
        { parentId: dirId, isDeleted: false },
        {
          $set: {
            isDeleted: true,
            deletedBy: "process",
            deletedAt: new Date(),
          },
        },
        { session },
      );
    }

    for (const child of children) {
      await recursiveRemove(child, session, visited);
    }
  } catch (err) {
    throw err;
  }
};

/**
 * Utility: recursiveDelete
 * what it do: Permanently delete a directory and all contents from DB and storage. Decrements file reference counts, deletes physical files.
 * requirements:
 *   - dir: Directory document to permanently delete
 *   - visited: Set to track visited directories and prevent cycles
 *   - Deletes from DB, decrements file refCounts, removes physical files from disk when refCount reaches 0
 */
export const recursiveDelete = async (
  parentId,
  visited,
  session,
  filesToDelete,
) => {
  try {
    if (visited.has(parentId.toString())) return;
    visited.add(parentId.toString());

    // 1. unlink all files from storage & delete info from Db
    const files = await UserFile.find({ parentId })
      .select("meta")
      .populate({ path: "meta", select: "objectKey refCount" })
      .session(session);

    const children = await Directory.find({ parentId })
      .select("_id")
      .session(session);

    // 2. depth-first delete child
    for (const child of children) {
      await recursiveDelete(child._id, visited, session, filesToDelete);
    }

    for (const file of files) {
      if (!file.meta) continue;

      const updt = await FileModel.findOneAndUpdate(
        { _id: file.meta._id, refCount: { $gt: 0 } },
        { $inc: { refCount: -1 } },
        { new: true, session },
      );

      if (updt && updt.refCount < 1) {
        //delete from db
        await FileModel.deleteOne({ _id: updt._id }).session(session);
        //delete  from local
        const absolutePath = path.join(UPLOAD_ROOT, file.meta.objectKey);
        filesToDelete.push(absolutePath);
      }
    }

    await Directory.deleteMany({ parentId }).session(session);
    await UserFile.deleteMany({ parentId }).session(session);
  } catch (err) {
    throw err;
  }
};
