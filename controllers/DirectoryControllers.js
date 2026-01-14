import path from "path";
import archiver from "archiver";
import mongoose from "mongoose";

import { recursiveDelete, recursiveRemove } from "../utils/remove.js";
import { restoreDirectory } from "../utils/restore.js";
import { serveZip, sanitizeName } from "../utils/serve.js";
import { badRequest, notFound, getDbData } from "../utils/helper.js";

import {Directory} from "../models/directory.model.js";

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
      deletedBy: "none",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res
      .status(201)
      .json({ sucess: true, message: "Folder created.", dir });
  } catch (err) {
    next(err);
  }
};

const handleGetDirectories = async (req, res, next) => {
  try {
    const userId = req.user._id;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return badRequest(res, "Please provide a valid id.");
    }

    const directory = await Directory.findOne({
      _id: req.params.id,
      userId,
      isDeleted: false,
    }).lean();

    if (!directory)
      return notFound(res, "directory not found! Maybe it have got deleted.");

    const parent = {
      dirId: directory._id,
      dirName: directory.name,
      userId,
      isDeleted: false,
    };

    const dir = await getDbData(parent);

    return res.status(200).json({ message: "directory found.", dir });
  } catch (err) {
    next(err);
  }
};

const handleUpdateDirectory = async (req, res, next) => {
  const { newname } = req.body;
  const parent = req.parentDir;
  const action = path.basename(req.path);

  const userId = req.user._id;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  try {
    const dir = await Directory.findOne(
      {
        _id: req.params.id,
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

      const moved = await Directory.updateOne(
        { _id: dir._id },
        { $set: { parentId: parent?._id || null, updatedAt: new Date() } },{new:true}
      );

      return res.status(200).json({
        success: true,
        message: "Moved successfully.",
        dir:moved
      });
    }

    /*********** RENAME ********/

    if (!newname) return badRequest(res, "newname not found in request!!");

    const renamed = await Directory.updateOne(
      { _id: dir._id },
      { $set: { name: newname, updatedAt: new Date() } }
    );

    return res
      .status(200)
      .json({ message: "Folder renamed successfully.", dir: renamed });
  } catch (err) {
    next(err);
  }
};

const handleDownloadDirectory = async (req, res, next) => {
  const userId = req.user._id;
  const dirId = req.params.id;

  if (!mongoose.isValidObjectId(dirId)) {
    return badRequest(res, "Please provide a valid id!!");
  }

  try {
    const dir = await Directory.findOne(
      {
        _id: dirId,
        userId,
        isDeleted: false,
      },
      { name: 1 }
    ).lean();

    if (!dir) {
      return res.status(404).json({ message: "Directory not found!" });
    }

    const safeDirname = sanitizeName(dir.name);
    const safeTimeStamp = new Date().toISOString().replace(/[-:.]/g, "");

    // const zipName = `${dir.name}-${new Date().toJSON()}-${dir.filesCount}-001.zip`; //google drive naming

    const zipName = `${safeDirname}-${safeTimeStamp}-001.zip`;
    // const zipPath = path.join(process.cwd(),"uploads", "temp", zipName);
    // const output = createWriteStream(zipPath);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
    // res.status(200).setHeader("Content-Length", dir.size);

    // Create ZIP stream
    const archive = archiver("zip", {
      zlib: { level: 2 }, // fast compression 
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

    req.on("end", () => console.log("Zip served successFully."));

    archive.on("error", (err) => {
      throw err;
    });

    // archive.pipe(output);
    // console.log("Zip creating started..");

    archive.pipe(res);
    console.log("Zip serving started..");

    // Traverse folder tree and add files
    const visited = new Set();

    await serveZip({
      archive,
      userId,
      dirId: dir._id,
      zipPath: `${dir.name}/`,
      visited,
      UPLOAD_ROOT,
    });

    // Finalize ZIP
    await archive.finalize();
    res.status(200).end();

  } catch (err) {
    next(err);
  }
};

const handleMoveToBinDirectory = async (req, res, next) => {
  const userId = req.user._id;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  try {
    const dir = await Directory.findOne(
      {
        _id: req.params.id,
        userId: userId,
        isDeleted: false,
        deletedBy: { $ne: "process" },
      }
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
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  try {
    const dir = await Directory.findOne(
      {
        _id: req.params.id,
        userId: userId,
        deletedBy: "user",
      }
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
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Please provide a valid id.");
  }

  try {
    const dir = await Directory.findOne(
      { _id: req.params.id, userId: userId },
      { _id: 1 }
    ).lean();

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
