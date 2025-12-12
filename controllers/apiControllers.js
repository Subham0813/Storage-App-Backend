import path from "path";
import { recursiveRemove } from "../utils/remove.js";
import { restoreDirectory, restoreFile } from "../utils/restore.js";
import { Db, ObjectId } from "mongodb";

/*
 ** helper Functions
 */
const badRequest = (res, message) =>
  res.status(400).json({ success: false, message: message });

const notFound = (res, message) =>
  res.status(404).json({ success: false, message: message });

const serverError = (err, res) => {
  console.log(err);
  return res
    .status(err.statusCode || 500)
    .json({ success: false, message: "Something went wrong!!." });
};

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
          mimeType: 1,
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

//env variables
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.resolve(process.cwd());

/*
 * API_HANDLERS
 */

const handleCreateFile = async (req, res) => {
  const db = req.db;
  const parent = req.parentDir;
  const file = req.file;
  const userId = req.user._id;

  if (!file) return badRequest(res, "no file in the request!");

  try {
    const { insertedId: id } = await db
      .collection("files")
      .insertOne({
        ...file,
        userId: userId,
        parentId: parent?._id || null,
        parentName: parent?.name || "",
        isDeleted: false,
        deletedBy: "",
        createdAt: new Date.now().toISOString(),
        modifiedAt: new Date.now().toISOString()
      });

    return res
      .status(201)
      .json({ message: "file uploaded successfull.", data: id });
  } catch (err) {
    return serverError(err, res);
  }
};

const handleCreateDirectory = async (req, res) => {
  const db = req.db;
  const parent = req.parentDir;
  const userId = req.user._id;

  try {
    const { insertedId: id } = await db.collection("directories").insertOne({
      name: req.body.name ? req.body.name : "Untitled Folder",
      parentId: parent?._id || null,
      parentName: parent?.name || "",
      userId: userId,
      isDeleted: false,
      deletedBy: "",
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    });

    return res.status(201).json({ message: "Folder created.", data: id });
  } catch (err) {
    return serverError(err, res);
  }
};

const handleGetDirectories = async (req, res) => {
  try {
    const db = req.db;
    const userId = req.user._id;

    //check for id validation
    if (!ObjectId.isValid(req.params.id))
      return badRequest(res, "please provide a valid id!!");

    const directory = await db
      .collection("directories")
      .findOne({ _id: new ObjectId(req.params.id), userId, isDeleted: false });

    if (!directory)
      return notFound(res, "directory not found! May be it is moved to bin.");

    const data = await getDbData(db, directory);

    return res.status(200).json({ message: "directory found.", data });
  } catch (err) {
    return serverError(err, res);
  }
};

const handleGetFiles = async (req, res, next) => {
  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "please provide a valid id!!");

  const db = req.db;
  const userId = req.user._id;

  try {
    const file = await db
      .collection("files")
      .findOne({ _id: new ObjectId(req.params.id), userId, isDeleted: false });

    if (!file)
      return notFound(res, "file not found! May be it is moved to bin.");

    if (file.mimetype.startsWith("video") && file.mimetype !== "video/mp4")
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.originalname}"`
      );

    const filePath = path.resolve(UPLOAD_ROOT, file.path);
    return res.sendFile(filePath, (err) =>
      err ? next(err) : console.log("file delivered gracefully..✨")
    );
  } catch (err) {
    return serverError(err, res);
  }
};

const handleUpdateFile = async (req, res) => {
  const { newname } = req.body;
  const db = req.db;
  const userId = req.user._id;

  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "please provide a valid id!!");

  if (!newname) return badRequest(res, "newname not found in the request!!");

  try {
    //changing filename if exists in filesDb
    const file = await db.collection("files").findOne({
      _id: new ObjectId(req.params.id),
      userId: userId,
      isDeleted: false,
    });
    if (!file)
      return notFound(res, "file not found! May be it is moved to bin.");

    const currExt = path.extname(file.originalname);
    const reqExt = path.extname(newname);

    const finalName =
      currExt === reqExt
        ? newname
        : `${path.basename(newname, reqExt)}${currExt}`;

    const update = await db.collection("files").updateOne(
      { _id: new ObjectId(req.params.id), userId: userId, isDeleted: false },
      {
        $set: { originalname: finalName, modifiedAt: new Date().toISOString() },
      }
    );

    return res
      .status(200)
      .json({ message: "File renamed successfully.", data: update });
  } catch (err) {
    return serverError(err, res);
  }
};

const handleUpdateDirectory = async (req, res) => {
  const { newname } = req.body;
  const db = req.db;
  const userId = req.user._id;

  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "please provide a valid id!!");

  if (!newname) return badRequest(res, "newname not found in request!!");

  try {
    const dir = await db.collection("directories").findOne({
      _id: new ObjectId(req.params.id),
      userId: userId,
      isDeleted: false,
    });
    if (!dir)
      return badRequest(res, "folder not found! May be it is moved to bin.");

    const update = await db.collection("directories").updateOne(
      { _id: new ObjectId(req.params.id), userId, isDeleted: false },
      {
        $set: { name: newname, modifiedAt: new Date().toISOString() },
      }
    );
    return res
      .status(200)
      .json({ message: "Folder renamed successfully.", data: update });
  } catch (err) {
    return serverError(err, res);
  }
};

const handleMoveToBinFile = async (req, res) => {
  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "please provide a valid id!!");

  const db = req.db;
  const userId = req.user._id;

  try {
    const file = await db.collection("files").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId,
        deletedBy: { $exists: false },
      },
      { projection: { _id: 1 } }
    );

    if (!file)
      return badRequest(res, "file not found! May be it is moved to bin.");

    const op = await db.collection("files").updateOne(
      { _id: file._id },
      {
        $set: {
          isDeleted: true,
          modifiedAt: new Date().toISOString(),
          deletedBy: "user",
        },
      }
    );

    return res.status(200).json({ message: "File moved to bin.", data: op });
  } catch (err) {
    return serverError(err, res);
  }
};

const handleMoveToBinDirectory = async (req, res) => {
  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "please provide a valid id!!");

  const db = req.db;
  const userId = req.user._id;
  try {
    const dir = await db.collection("directories").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        deletedBy: { $exists: false },
      },
      { projection: { _id: 1 } }
    );

    if (!dir)
      return notFound(res, "directory not found! May be it is moved to bin.");

    const visited = new Set();
    const result = new Map();
    const recRm = await recursiveRemove(db, dir._id, userId, visited, result);

    const rm = await db.collection("directories").updateOne(
      { _id: dir._id },
      {
        $set: {
          isDeleted: true,
          modifiedAt: new Date().toISOString(),
          deletedBy: "user",
        },
      }
    );

    return res
      .status(200)
      .json({ message: "Folder moved to bin.", data: { rm, recRm } });
  } catch (err) {
    console.log(err);
    return serverError(err, res);
  }
};

const handleRestoreFile = async (req, res) => {
  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "please provide a valid id!!");

  const db = req.db;
  const userId = req.user._id;

  try {
    const file = await db.collection("files").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        isDeleted: true,
        deletedBy: "user",
      },
      { projection: { _id: 1, originalname: 1, parentId: 1, parentName: 1 } }
    );

    if (!file) return notFound(res, "file not found!");

    const op = await restoreFile(db, userId, file);

    return res
      .status(200)
      .json({ message: "file restored successfully.", data: op });
  } catch (err) {
    return serverError(err, res);
  }
};

const handleRestoreDirectory = async (req, res) => {
  const db = req.db;
  const userId = req.user._id;

  //check for id validation
  if (!ObjectId.isValid(req.params.id))
    return badRequest(res, "please provide a valid id!");

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

    return res
      .status(200)
      .json({ message: "Folder restored successfully.", data: op });
  } catch (err) {
    return serverError(err, res);
  }
};

export {
  handleGetDirectories,
  handleGetFiles,
  handleCreateFile,
  handleCreateDirectory,
  handleUpdateFile,
  handleUpdateDirectory,
  handleMoveToBinFile,
  handleMoveToBinDirectory,
  handleRestoreFile,
  handleRestoreDirectory,
};
