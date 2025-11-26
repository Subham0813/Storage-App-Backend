import { writeFile } from "fs/promises";
import { env } from "process";
import { removeDirectory, removeFile } from "../utils/removeDirectory.js";
import { restoreDirectory, restoreFile } from "../utils/restoreFile.js";
import { Db, ObjectId } from "mongodb";

let { default: directoriesDb } = await import("../DBs/directories.db.json", {
  with: { type: "json" },
});
let { default: filesDb } = await import("../DBs/files.db.json", {
  with: { type: "json" },
});
let { default: bin } = await import("../DBs/bins.db.json", {
  with: { type: "json" },
});

const handleGetDirectories = async (req, res) => {
  try {
    const db = req.db;
    const userId = req.user._id;

    const directory = await db
      .collection("directories")
      .findOne({ _id: new ObjectId(req.params.id), userId });

    if (!directory || directory.isDeleted)
      return res.status(404).json({
        message: "directory not found! May be it is moved to bin.",
        data: null,
      });

    const directories = await db
      .collection("directories")
      .find(
        { userId, parentId: directory._id, isDeleted: false },
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
        { userId, parentId: directory._id, isDeleted: false },
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

    const data = {
      _id: directory._id,
      name: directory.name,
      directories,
      files,
    };

    return res.status(200).json({ message: "directory found.", data });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error", data: null });
  }
};

const handleGetFiles = async (req, res) => {
  const db = req.db;
  const userId = req.user._id;

  try {
    const file = await db
      .collection("files")
      .findOne({ _id: new ObjectId(req.params.id), userId, isDeleted: false });

    if (!file)
      return res.status(404).json({
        message: "file not found! May be it is moved to bin.",
        data: null,
      });

    const path = `C:\\Subham_dir\\ProCodrr-NodeJS\\Storage-App-Express\\backend\\${file.path}`;
    return res.sendFile(path, (error) => console.log(error));
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error", data: null });
  }
};

const handleCreateFile = async (req, res) => {
  const db = req.db;
  const dirId = req.params.dirId;
  const userId = req.user._id;
  const file = req.file;

  if (!file)
    return res
      .status(400)
      .json({ message: "no file in the request!", data: null });

  try {
    const parentDirectory = dirId
      ? await db
          .collection("directories")
          .findOne({ userId, _id: new ObjectId(dirId) })
      : await db.collection("directories").findOne({ userId, parentId: null });

    if (!parentDirectory || parentDirectory.isDeleted)
      return res
        .status(404)
        .json({ message: "Directory Not Found!", data: null });

    file.userId = userId;
    file.parentId = parentDirectory._id;
    file.parentName = parentDirectory.name;
    file.isDeleted = false;

    const { insertedId: id } = await db.collection("files").insertOne(file);

    return res
      .status(201)
      .json({ message: "file uploaded successfull.", data: id });
  } catch (error) {
    console.log(error.message);
    return res
      .status(500)
      .json({ message: "Internal server error.", data: null });
  }
};

const handleCreateDirectory = async (req, res) => {
  const db = req.db;
  const dirId = req.params.dirId;
  const userId = req.user._id;

  try {
    const parentDirectory = dirId
      ? await db
          .collection("directories")
          .findOne({ userId, _id: new ObjectId(dirId) })
      : await db.collection("directories").findOne({ userId, parentId: null });

    if (!parentDirectory || parentDirectory.isDeleted)
      return res
        .status(404)
        .json({ message: "Directory Not Found!", data: null });

    const { insertedId: id } = await db.collection("directories").insertOne({
      name: req.body.name ? req.body.name : "Untitled Folder",
      parentId: parentDirectory._id,
      parentName: parentDirectory.name,
      userId: userId,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    });

    return res.status(201).json({ message: "Folder created.", data: id });
  } catch (error) {
    console.log(error.message);
    return res
      .status(500)
      .json({ message: "Internal server error.", data: null });
  }
};

const handleUpdateFile = async (req, res) => {
  const { newname } = req.body;
  const db = req.db;
  const userId = req.user._id;

  if (!newname || newname.length < 0)
    return res.status(400).json({
      message: "name should be one or more than one characters long!",
    });

  try {
    //changing filename if exists in filesDb
    const update = await db.collection("files").updateOne(
      { _id: new ObjectId(req.params.id), userId, isDeleted: false },
      {
        $set: { originalname: newname, modifiedAt: new Date().toISOString() },
      }
    );

    return res
      .status(200)
      .json({ message: "File renamed successfully.", data: update });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error.", data: null });
  }
};

const handleUpdateDirectory = async (req, res) => {
  const { newname } = req.body;
  const db = req.db;
  const userId = req.user._id;

  if (!newname || newname.length < 0)
    return res.status(400).json({
      message: "bad request! newname should pass on with body.",
    });

  try {
    const update = await db.collection("directories").updateOne(
      { _id: new ObjectId(req.params.id), userId },
      {
        $set: { name: newname, modifiedAt: new Date().toISOString() },
      }
    );
    return res
      .status(200)
      .json({ message: "Folder renamed successfully.", data: update });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error.", data: null });
  }
};

const handleMoveToBinFile = async (req, res) => {
  // console.log(req.originalUrl)
  const db = req.db;
  const userId = req.user._id;
 

  try {
    const file = await db
      .collection("files")
      .findOne({ _id: new ObjectId(req.params.id), userId, isDeleted: false });

    if (!file)
      return res.status(404).json({
        message: "file not found! May be it is moved to bin.",
        data: null,
      });

    await db.collection("files").updateOne(
      { _id: new ObjectId(req.params.id), userId, isDeleted: false },
      {
        $set: { isDeleted: true, modifiedAt: new Date().toISOString() },
      }
    );

    await db.collection("bins").updateOne(
      { userId: userId },
      {
        $set: {
          files: [...bin.files, { _id: file._id, name: file.originalname }],
        },
      }
    );

    return res.status(200).json({ message: "File moved to bin.", data: {} });
  } catch (error) {
    console.log({ error });
    return res
      .status(500)
      .json({ message: "Internal server error.", data: null });
  }
};

const handleMoveToBinDirectory = async (req, res) => {
  const userContent = directoriesDb.find(
    (item) => item.id === req.user.id
  ).content;

  const directory = userContent.find((item) => item.id === req.params.id);
  if (!directory)
    return res
      .status(404)
      .json({ message: "Folder not found !! try with a valid id." });
  try {
    await removeDirectory(req.user.id, directory);
    return res.status(200).json({ message: "Folder moved to bin." });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const handleRestoreFile = async (req, res) => {
  const db = req.db;
  const userId = req.user._id;

  try {
  const file = await db
      .collection("files")
      .findOne({ _id: new ObjectId(req.params.id), userId, isDeleted: false });

    if (!file)
      return res.status(404).json({
        message: "file not found! May be it is moved to bin.",
        data: null,
      });

    await restoreFile(db, userId, file);
    return res.status(200).json({ message: "file is restored to its path." });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const handleRestoreDirectory = async (req, res) => {
  const directory = bin
    .find((item) => item.id === req.user.id)
    .content[0].directories.find((item) => item.id === req.params.id);

  if (!directory)
    return res
      .status(404)
      .json({ message: "Folder not found !! try with a valid id." });

  try {
    await restoreDirectory(req.user.id, directory.id);
    return res.status(200).json({ message: "Folder restored successfully." });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error." });
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
