import path from "path";
import archiver from "archiver";
import { Db, ObjectId } from "mongodb";

import { recursiveDelete, recursiveRemove } from "../utils/remove.js";
import { restoreDirectory } from "../utils/restore.js";

import serve from "../utils/serve.js";

//env variables
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.resolve(process.cwd() +"/uploads");

/* helper Functions */
const badRequest = (res, message) =>
  res.status(400).json({ success: false, message: message });

const notFound = (res, message) =>
  res.status(404).json({ success: false, message: message });

const getDbData = async (db, directory) => {
  const directories = await db
    .collection("directories")
    .find(
      { parentId: directory._id, isDeleted: false },
      {
        projection: {
          _id: 1,
          name: 1,
          createdAt: 1,
          modifiedAt: 1,
        },
      }
    )
    .toArray();

  const files = await db
    .collection("files")
    .find(
      { parentId: directory._id, isDeleted: false },
      {
        projection: {
          originalname: 1,
          size: 1,
          detectedMime: 1,
          createdAt: 1,
          modifiedAt: 1,
          _id: 1,
        },
      }
    )
    .toArray();

  return {
    _id: directory._id,
    name: directory.name,
    directories,
    files,
  };
};

// API Handlers

const handleCreateDirectory = async (req, res, next) => {
  const db = req.db;
  const parent = req.parentDir;
  const userId = req.user._id;

  let ancestors = [];
  if (parent?.ancestors) {
    ancestors = [...parent.ancestors, parent._id];
  }

  try {
    const { insertedId: id } = await db.collection("directories").insertOne({
      name: req.body.name ? req.body.name.toString() : "Untitled Folder",
      parentId: parent?._id || null,
      ancestors: ancestors,
      userId: userId,
      isDeleted: false,
      deletedBy: "",
      deletedAt: null,
      createdAt: new Date(),
      modifiedAt: new Date(),
    });

    return res.status(201).json({ message: "Folder created.", data: id });
  } catch (err) {
    return next(err);
  }
};

const handleGetDirectories = async (req, res, next) => {
  try {
    const db = req.db;
    const userId = req.user._id;

    //check for id validation
    if (!ObjectId.isValid(req.params.id))
      return badRequest(res, "Please provide a valid id.");

    const directory = await db
      .collection("directories")
      .findOne({ _id: new ObjectId(req.params.id), userId, isDeleted: false });

    if (!directory)
      return notFound(res, "directory not found! Maybe it have got deleted.");

    const data = await getDbData(db, directory);

    return res.status(200).json({ message: "directory found.", data });
  } catch (err) {
    return next(err);
  }
};

const handleUpdateDirectory = async (req, res, next) => {
  const { newname } = req.body;
  const db = req.db;
  const userId = req.user._id;

  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "Please provide a valid id!!");

  if (!newname) return badRequest(res, "newname not found in request!!");

  try {
    const dir = await db.collection("directories").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: false,
      },
      { projection: { _id: 1 } }
    );
    if (!dir)
      return badRequest(res, "Folder not found! May be it have got deleted.");

    const update = await db.collection("directories").updateOne(
      { _id: dir._id },
      {
        $set: { name: newname, modifiedAt: new Date() },
      }
    );
    return res
      .status(200)
      .json({ message: "Folder renamed successfully.", data: update });
  } catch (err) {
    next(err);
  }
};

const handleDownloadDirectory = async (req, res, next) => {
  const db = req.db;
  const userId = req.user._id;
  const dirId = req.params.id;

  if (!ObjectId.isValid(dirId)) {
    return badRequest(res, "Please provide a valid id!!");
  }

  try {
    const dir = await db.collection("directories").findOne({
      _id: new ObjectId(dirId),
      userId,
      isDeleted: false,
    });

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
      db,
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
  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "Please provide a valid id!!");

  const db = req.db;
  const userId = req.user._id;
  try {
    const dir = await db.collection("directories").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: false,
        deletedBy: { $ne: "process" },
      },
      { projection: { _id: 1 } }
    );

    if (!dir)
      return notFound(res, "directory not found! May be it have got deleted.");

    const visited = new Set();
    const recRm = await recursiveRemove(db, dir._id, userId, visited);

    const rm = await db.collection("directories").updateOne(
      { _id: dir._id },
      {
        $set: {
          isDeleted: true,
          modifiedAt: new Date(),
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
  const db = req.db;
  const userId = req.user._id;

  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "Please provide a valid id!");

  try {
    const dir = await db.collection("directories").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        deletedBy: "user",
      },
      { projection: { _id: 1, name: 1, parentId: 1, parentName: 1 } }
    );

    if (!dir) return notFound(res, "directory not found!");

    const op = await restoreDirectory(db, userId, dir);

    return res.status(200).json({ message: "Folder restored successfully." });
  } catch (err) {
    next(err);
  }
};

const handleDeleteDirectory = async (req, res, next) => {
  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "Please provide a valid id!!");

  const db = req.db;
  const userId = req.user._id;

  const dir = await db.collection("directories").findOne(
    {
      _id: new ObjectId(req.params.id),
      userId: userId,
      deletedBy: { $in: ["", "user"] },
    },
    { projection: { _id: 1 } }
  );
  console.log(dir)

  if (!dir)
    return notFound(res, "directory not found! May be it have got deleted.");

  const visited = new Set();
  const recRm = await recursiveDelete(db, dir._id, userId, visited);

  const rm = await db.collection("directories").deleteOne({ _id: dir._id });

  return res.status(200).json({
    message: "Folder deletion successfull and no longer available.",
  });
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
