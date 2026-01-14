import path from "path";
import archiver from "archiver";
import { Db, ObjectId } from "mongodb";

import { recursiveDelete, recursiveRemove } from "../utils/remove.js";
import { restoreDirectory } from "../utils/restore.js";
import serve from "../utils/serve.js";
import { badRequest, notFound, getDbData } from "../utils/helper.js";

import Directory from "../models/directory.model.js";

//env variables
const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

// API Handlers

const handleCreateDirectory = async (req, res, next) => {
  const parent = req.parentDir;
  const userId = req.user._id;

  try {
    const dir = await Directory.insertOne({
      name: req.body.name ? req.body.name.toString() : "Untitled Folder",
      parentId: parent?._id || null,
      userId: userId,
      isDeleted: false,
      deletedBy: "",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res
      .status(201)
      .json({ sucess: true, message: "Folder created.", data: dir });
  } catch (err) {
    next(err);
  }
};

const handleGetDirectories = async (req, res, next) => {
  try {
    const userId = req.user._id;
    if (!ObjectId.isValid(req.params.id)) {
      return badRequest(res, "Please provide a valid id.");
    }

    const directory = await Directory.findOne({
      _id: new ObjectId(req.params.id),
      userId,
      isDeleted: false,
    }).lean();

    if (!directory)
      return notFound(res, "directory not found! Maybe it have got deleted.");

    const data = await getDbData(directory);

    return res.status(200).json({ message: "directory found.", data });
  } catch (err) {
    next(err);
  }
};

const handleUpdateDirectory = async (req, res, next) => {
  const { newname } = req.body;
  const parent = req.parentDir;
  const action = path.basename(req.path);

  const userId = req.user._id;
  if (!ObjectId.isValid(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  try {
    const dir = await Directory.findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: false,
      },
      { parentId: 1 }
    ).lean();

    if (!dir)
      return badRequest(res, "Folder not found! May be it have got deleted.");

    /*********** MOVE *********/

    if (action === "move") {
      if (
        (dir.parentId === null && !parent) ||
        dir.parentId?.toString() === parent?._id?.toString()
      ) {
        return badRequest(res, "Folder already in the target destination!");
      }

      await Directory.updateOne(
        { _id: dir._id },
        { $set: { parentId: parent?._id || null, updatedAt: new Date() } }
      );

      return res.status(200).json({
        success: true,
        message: "Moved successfully.",
      });
    }

    /*********** RENAME ********/

    if (!newname) return badRequest(res, "newname not found in request!!");

    const update = await Directory.updateOne(
      { _id: dir._id },
      { $set: { name: newname, updatedAt: new Date() } }
    );

    return res
      .status(200)
      .json({ message: "Folder renamed successfully.", data: update });
  } catch (err) {
    next(err);
  }
};

const handleDownloadDirectory = async (req, res, next) => {
  const userId = req.user._id;
  const dirId = req.params.id;

  if (!ObjectId.isValid(dirId)) {
    return badRequest(res, "Please provide a valid id!!");
  }

  try {
    const dir = await Directory.findOne(
      {
        _id: new ObjectId(dirId),
        userId,
        isDeleted: false,
      },
      { name: 1 }
    ).lean();

    if (!dir) {
      return res.status(404).json({ message: "Directory not found!" });
    }

    const zipName = `${dir.name}.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    // Create ZIP stream
    const archive = archiver("zip", {
      zlib: { level: 1 }, // fast compression (Google Drive like)
    });

    // If client aborts, stop everything
    req.on("close", () => {
      console.log("Client aborted download!!");
      archive.abort();
    });
    req.on("aborted", () => {
      console.log("Client aborted download!!");
      archive.abort();
    });

    archive.on("error", (err) => {
      throw err;
    });

    archive.pipe(res);
    console.log("Zip serving started..");

    // Traverse folder tree and add files
    const visited = new Set();

    await serve({
      archive,
      userId,
      dirId: dir._id,
      zipPath: `${dir.name}/`,
      visited,
      UPLOAD_ROOT,
    });

    // Finalize ZIP
    await archive.finalize();
  } catch (err) {
    next(err);
  }
};

const handleMoveToBinDirectory = async (req, res, next) => {
  const userId = req.user._id;
  if (!ObjectId.isValid(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  try {
    const dir = await Directory.findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: false,
        deletedBy: { $ne: "process" },
      },
      { _id: 1 }
    ).lean();

    if (!dir)
      return notFound(res, "directory not found! May be it have got deleted.");

    const visited = new Set();
    const recRm = await recursiveRemove(dir._id, userId, visited);

    const rm = await Directory.updateOne(
      { _id: dir._id },
      {
        $set: {
          isDeleted: true,
          updatedAt: new Date(),
          deletedAt: new Date(),
          deletedBy: "user",
        },
      }
    );

    return res.status(200).json({
      message: "Folder moved to bin successfully.",
    });
  } catch (err) {
    next(err);
  }
};

const handleRestoreDirectory = async (req, res, next) => {
  const userId = req.user._id;
  if (!ObjectId.isValid(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  try {
    const dir = await Directory.findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        deletedBy: "user",
      },
      { name: 1, parentId: 1, parentName: 1 }
    );

    if (!dir) return notFound(res, "directory not found!");

    const op = await restoreDirectory(userId, dir);
    console.log(op);

    return res.status(200).json({ message: "Folder restored successfully." });
  } catch (err) {
    next(err);
  }
};

const handleDeleteDirectory = async (req, res, next) => {
  const userId = req.user._id;
  if (!ObjectId.isValid(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  try {
    const dir = await Directory.findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        deletedBy: { $in: ["", "user"] },
      },
      { _id: 1 }
    );

    if (!dir)
      return notFound(res, "directory not found! May be it have got deleted.");

    const visited = new Set();
    const recRm = await recursiveDelete(dir._id, userId, visited);

    const rm = await Directory.deleteOne({ _id: dir._id });

    return res.status(200).json({
      message: "Folder deletion successfull and no longer available.",
    });
  } catch (err) {
    next(err);
  }
};

export {
  handleGetDirectories,
  handleCreateDirectory,
  handleDownloadDirectory,
  handleUpdateDirectory,
  handleMoveToBinDirectory,
  handleRestoreDirectory,
  handleDeleteDirectory,
};
