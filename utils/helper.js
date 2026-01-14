import { createReadStream } from "fs";
import crypto from "crypto";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

const getFileHash = (filePath, hashAlgo = "sha256", digestArg = "hex") => {
  return new Promise((resolve, reject) => {
    //prevent duplication flow
    // multer upload @ tmp -> stream tempfile -> create hash /w secrete -> check existance -> return response

    const rs = createReadStream(filePath);
    const hash = crypto.createHash(hashAlgo);

    rs.on("data", (chunk) => hash.update(chunk));

    rs.on("end", async () => {
      const fileHash = hash.digest(digestArg);
      return resolve(fileHash);
    });

    rs.on("error", (err) => reject(err));
  });
};

const getMetadata = (file) => {
  if (!file) return {};
  const metadata = {
    id: file._id,
    parentId: file.parentId,
    name: file.name,
    mimetype: file.mimetype,
    detectedMime: file.meta.detectedMime || "",
    size: file.meta.size,
    disposition: file.disposition,
    inline_preview: file.inline_preview,
    force_inline_preview: file.force_inline_preview,
    isDeleted: file.isDeleted,
    deletedBy: file.deletedBy,
    deletedAt: file.deletedAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
  return metadata;
};

const getFileDoc = (file) => {
  if (!file) return {};
  const fileDoc = {
    userId: file.userId || null,
    parentId: file.parentId || null,
    meta: file.meta || null,

    name: file.name,
    mimetype: file.mimetype,

    isDeleted: false,
    deletedBy: "none",
    deletedAt: null,
  };
  return fileDoc;
};

const getDbData = ({ dirId, dirName, userId, isDeleted }) => {
  return new Promise(async (resolve, reject) => {
    try {
      const directories = await Directory.find({
        parentId: dirId,
        userId,
        isDeleted,
      }).lean();

      const files = await UserFile.find(
        { parentId: dirId, userId, isDeleted },
        {
          name: 1,
          mimetype: 1,
          disposition: 1,
          inline_preview: 1,
          force_inline_preview: 1,
        }
      )
        .populate({ path: "meta", select: "size detectedMime -_id" })
        .lean();

      const flattenedFiles = files.map(({ meta, ...rest }) => ({
        ...rest,
        ...meta,
      }));

      return resolve({
        _id: dirId,
        name: dirName,
        directories,
        files: flattenedFiles,
      });
    } catch (err) {
      reject(err);
    }
  });
};

const getUserPayload = (user) => {
  if(!user) return null
  
  return {
    id:user. _id,
    fullname: user.fullname,
    username:user.username,
    email:user.email,
    deviceCount:user.deviceCount,
    createdAt:user.createdAt,
    updatedAt:user.updatedAt,
  }
}

const badRequest = (res, message) =>
  res.status(400).json({ success: false, message });

const notFound = (res, message) =>
  res.status(404).json({ success: false, message });

export {
  badRequest,
  notFound,
  getDbData,
  getFileDoc,
  getMetadata,
  getFileHash,
  getUserPayload
};
