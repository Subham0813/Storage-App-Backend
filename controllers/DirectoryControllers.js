import path from "path";
import archiver from "archiver";
import mongoose from "mongoose";

import { recursiveDelete, recursiveRemove } from "../utils/remove.js";
import { restoreDirectory } from "../utils/restore.js";
import { serveZip, sanitizeName } from "../utils/serve.js";
import { badRequest, notFound } from "../utils/helper.js";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { base64URLEncode } from "./oauthControllers.js";
import { recursiveChangePermission } from "../utils/changePermission.js";

//env variables
const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

// API Handlers
export const createDirectoryHandler = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return badRequest(res, "Invalid id.");
    }

    const parent = await Directory.findOne({
      _id: req.params.id,
      isDeleted: false,
      userId: req.user._id,
    }).lean();

    if(!parent) return notFound(res, "Invalid parentId")

    const dir = await Directory.insertOne({
      name: req.body.name ? req.body.name.toString() : "Untitled Directory",
      parentId: parent._id,
      userId: req.user._id,
      isDeleted: false,
      deletedBy: "none",
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Directory created.",
      data: { directory: dir },
    });
  } catch (err) {
    next(err);
  }
};

export const getDirectoryInfoHandler = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return badRequest(res, "Invalid id.");
    }

    const dir = await Directory.findOne(
      {
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: false,
      }
    ).lean();

    if (!dir) return notFound(res, "directory not found.");

    return res
      .status(200)
      .json({ message: "directory found.", data: { directory: dir } });
  } catch (err) {
    next(err);
  }
};

export const getDirectoriesHandler = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return badRequest(res, "Invalid id.");
    }

    const dirs = await Directory.find(
      {
        parentId: req.params._id,
        userId: req.user._id,
        isDeleted: false,
      }
    ).lean();

    if (!dirs) return notFound(res, "directory not found.");

    return res
      .status(200)
      .json({ message: "directory found.", data: { directories: dirs } });
  } catch (err) {
    next(err);
  }
};

export const getAllFilesHandler = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return badRequest(res, "Invalid id.");
    }

    const files = await UserFile.find({
      parentId: req.params._id,
      userId: req.user._id,
      isDeleted: false,
    })
      .populate({ path: "meta", select: "size detectedMime -_id" })
      .lean();

    if (!files) return notFound(res, "files not found.");

    const flattenedFiles = files.map(({ meta, ...rest }) => ({
      ...rest,
      ...meta,
    }));

    return res.status(200).json({ data: { files: flattenedFiles } });
  } catch (err) {
    next(err);
  }
};

export const renameDirectoryHandler = async (req, res, next) => {
  const { newname } = req.body;

  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return badRequest(res, "Invalid id.");
    }

    if (!newname) return badRequest(res, "Newname is missing.");

    const dir = await Directory.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: false,
      },
      { name: newname.toString(), updatedAt: new Date() },
      { new: true },
    ).lean();

    if (!dir) return badRequest(res, "Directory not found.");

    return res
      .status(200)
      .json({ message: "Directory Renamed.", data: { directory: renamed } });
  } catch (err) {
    next(err);
  }
};

export const moveDirectoryHandler = async (req, res, next) => {
  const { targetId } = req.body;
  if (!mongoose.isValidObjectId(targetId)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const targetDir = await Directory.exists({
      _id: targetId,
      userId: req.user._id,
      isDeleted: false,
    });

    if (!targetDir) return notFound(res, "Target not found.");

    const dir = await Directory.exists({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    });

    if (!dir) return notFound(res, "Directory not found.");

    if (dir.parentId === targetId)
      return badRequest(res, "Directory already in the target destination!");

    const moved = await Directory.findOneAndUpdate(
      { _id: dir._id },
      { $set: { parentId: req.parentDir._id, updatedAt: new Date() } },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      message: "Directory moved.",
      data: { directory: moved },
    });
  } catch (err) {
    next(err);
  }
};

export const downloadDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const dir = await Directory.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    }).lean();

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

    req.on("end", () => console.log("Zip served successfully."));

    archive.on("error", (err) => {
      archive.abort();
      next(err);
    });

    // archive.pipe(output);
    // console.log("Zip creating started..");

    archive.pipe(res);
    console.log("Zip serving started..");

    // Traverse Directory tree and add files
    const visited = new Set();

    await serveZip({
      archive,
      userId: req.user._id,
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

export const moveToBinDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const dir = await Directory.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: false,
        deletedBy: { $ne: "process" },
      },
      {
        $set: {
          isDeleted: true,
          updatedAt: new Date(),
          deletedAt: new Date(),
          deletedBy: "user",
        },
      },
    );

    if (!dir) return notFound(res, "directory not found.");
    await Directory.updateOne(
      { _id: dir.parentId },
      { $pull: { chidren: { $elemMatch: { _id: dir._id, name: dir.name } } } },
    );

    const visited = new Set();
    await recursiveRemove(dir, visited);

    return res.status(200).json({
      message: "Directory moved to bin.",
    });
  } catch (err) {
    next(err);
  }
};

export const restoreDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const dir = await Directory.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user._id,
        deletedBy: "user",
      },
      {
        $set: {
          isDeleted: false,
          deletedBy: "none",
          updatedAt: new Date(),
          deletedAt: null,
        },
      },
    );

    if (!dir) return notFound(res, "directory not found!");

    const op = await restoreDirectory(req.user._id, dir, req.user.rootDirId);

    await Directory.findOneAndUpdate(
      {
        _id: dir.parentId,
        children: { $nin: [{ _id: dir._id, name: dir.name }] },
      },
      {
        $push: {
          children: { $each: [{ _id: dir._id, name: dir.name }] },
        },
      },
    );

    return res.status(200).json({ message: "Directory restored." });
  } catch (err) {
    next(err);
  }
};

export const deleteDirectoryHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return badRequest(res, "Invalid id.");
  }

  try {
    const dir = await Directory.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!dir) return notFound(res, "directory not found.");

    const visited = new Set();
    await recursiveDelete(dir, visited);

    await Directory.updateOne(
      { _id: dir.parentId },
      { $pull: { chidren: { $elemMatch: { _id: dir._id, name: dir.name } } } },
    );

    return res.status(200).json({
      message: "Directory deletion successful and no longer available.",
    });
  } catch (err) {
    next(err);
  }
};

export const shareDirectoryHandler = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return badRequest(res, "Invalid id.");

    //emailWithRole: [{email: "", role:""}], publicRole: "", notify: true
    const { emailsWithRole, publicRole, notify } = req.body;

    if (!emailsWithRole && !publicRole)
      return badRequest(res, "Invalid payload.");

    if (
      publicRole &&
      !["VIEWER", "COMMENTER", "EDITOR"].includes(role.toUpperCase())
    )
      return badRequest(res, "Invalid `publicRole`.");

    const dir = await Directory.findOne({
      _id: req.params.id,
      userId: req.user._id,
      isDeleted: false,
    }).lean();

    if (!dir) return notFound(res, "Directory not found.");

    const validEmails = [];
    const skipped = [];

    for (const { email, role } of emailsWithRole) {
      if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
        skipped.push({ email, role, reason: "invalid email." });
      } else if (
        role &&
        !["VIEWER", "COMMENTER", "EDITOR"].includes(role.toUpperCase())
      ) {
        skipped.push({ email, role, reason: "invalid role." });
      } else
        validEmails.push({
          email,
          role: role.toUpperCase(),
          sharedAt: Date.now(),
        });
    }

    const shareToken = base64URLEncode(crypto.randomBytes(24)).toString(
      "base64url",
    );

    await Directory.findByIdAndUpdate(dir._id, {
      $push: { sharedWith: { $each: validEmails } },
      updatedAt: Date.now(),
    });

    res.status(200).json({
      success: true,
      message: "Permission changed for this directory.",
      skippedEmails: skipped,
      acceptedEmails: validEmails,
      shareItemId: dir._id.toString(),
    });

    if (notify && validEmails.length > 0) {
      //send notification to validEmails
      console.log("emails sent.");
    }

    if (itemType === "directory") {
      const visited = [];
      await recursiveChangePermission(item, visited);
    }
    return res.end();
  } catch (err) {
    next(err);
  }
};
