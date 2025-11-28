import path from "path";
import { recursiveRemove } from "../utils/removeDirectory.js";
import { restoreDirectory, restoreFile } from "../utils/restoreFile.js";
import { Db, ObjectId } from "mongodb";

const handleCreateFile = async (req, res) => {
  const db = req.db;
  const parent = req.parentDir;
  const file = req.file;
  const userId = req.user._id;

  if (!file)
    return res
      .status(400)
      .json({ message: "no file in the request!", data: null });

  try {
    file.userId = userId;
    file.parentId = parent?._id || null;
    file.parentName = parent?.name || "";
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
  const parent = req.parentDir;
  const userId = req.user._id;

  try {
    const { insertedId: id } = await db.collection("directories").insertOne({
      name: req.body.name ? req.body.name : "Untitled Folder",
      parentId: parent?._id || null,
      parentName: parent?.name || "",
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

const handleGetDirectories = async (req, res) => {
  try {
    const db = req.db;
    const userId = req.user._id;

    const directory = await db
      .collection("directories")
      .findOne({ _id: new ObjectId(req.params.id), userId, isDeleted: false });

    if (!directory)
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

    if (file.mimetype !== "video/mp4")
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.originalname}"`
      );
    return res.sendFile(path, (error) =>
      error
        ? console.log({ [error.name]: error.message })
        : console.log("file delivered gracefully..✨")
    );
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal server error", data: null });
  }
};

const handleUpdateFile = async (req, res) => {
  const { newname } = req.body;
  const db = req.db;
  const userId = req.user._id;

  if (!newname)
    return res.status(400).json({
      message: "name should be one or more than one characters long!",
    });

  try {
    //changing filename if exists in filesDb
    const file = await db.collection("files").findOne({
      _id: new ObjectId(req.params.id),
      userId: userId,
      isDeleted: false,
    });
    if (!file)
      return res.status(404).json({
        message: "file not found! May be it is moved to bin.",
        data: null,
      });

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

  if (!newname)
    return res.status(400).json({
      message: "bad request! newname should pass on with body.",
    });

  try {
    const dir = await db.collection("directories").findOne({
      _id: new ObjectId(req.params.id),
      userId: userId,
      isDeleted: false,
    });
    if (!dir)
      return res.status(404).json({
        message: "folder not found! May be it is moved to bin.",
        data: null,
      });

    const update = await db.collection("directories").updateOne(
      { _id: new ObjectId(req.params.id), userId, isDeleted: false },
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
    console.log(file);

    if (!file)
      return res.status(404).json({
        message: "file not found! May be it is moved to bin.",
        data: null,
      });

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
  } catch (error) {
    console.log({ error });
    return res
      .status(500)
      .json({ message: "Internal server error.", data: null });
  }
};

const handleMoveToBinDirectory = async (req, res) => {
  try {
    const db = req.db;
    const userId = req.user._id;

    const dir = await db.collection("directories").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        deletedBy: { $exists: false },
      },
      { projection: { _id: 1 } }
    );

    if (!dir)
      return res.status(404).json({
        message: "directory not found! May be it is moved to bin.",
        data: null,
      });

    const recRm = await recursiveRemove(db, dir._id, userId);

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
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ message: "Internal server error.", data: null });
  }
};

const handleRestoreFile = async (req, res) => {
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

    if (!file)
      return res.status(404).json({
        message: "file not found!",
        data: null,
      });

    const op = await restoreFile(db, userId, file);
    console.log(op);

    return res
      .status(200)
      .json({ message: "file restored successfully.", data: op });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ message: "Internal server error.", data: null });
  }
};

const handleRestoreDirectory = async (req, res) => {
  try {
    const db = req.db;
    const userId = req.user._id;

    const dir = await db.collection("directories").findOne(
      {
        _id: new ObjectId(req.params.id),
        userId: userId,
        deletedBy: "user",
      },
      { projection: { _id: 1, name: 1, parentId: 1, parentName: 1 } }
    );

    if (!dir)
      return res.status(404).json({
        message: "directory not found!",
        data: null,
      });

    const op = await restoreDirectory(db, userId, dir);

    return res
      .status(200)
      .json({ message: "Folder restored successfully.", data: op });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ message: "Internal server error.", data: null });
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
