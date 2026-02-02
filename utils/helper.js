import { createReadStream } from "fs";
import crypto from "crypto";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

export const getFileHash = (
  filePath,
  hashAlgo = "sha256",
  digestArg = "hex",
) => {
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


export const getFileDoc = (file) => {
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

export const getDbData = ({ dirId, dirName, userId, isDeleted }) => {
  return new Promise(async (resolve, reject) => {
    try {
      const directories = await Directory.find({
        parentId: dirId,
        userId,
        isDeleted,
      }).lean();

      const files = await UserFile.find({ parentId: dirId, userId, isDeleted })
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

export const getUserPayload = (user) => {
  if (!user) return null;

  const {
    _id,
    name,
    username,
    email,
    emailVerified,
    deviceCount,
    authProviders:authProvider,
    theme,
    allotedStorage,
    usedStorage,
    createdAt,
    updatedAt,
  } = user;

  return {
    _id,
    name,
    username,
    email,
    emailVerified,
    deviceCount,
    authProviders,
    theme,
    allotedStorage,
    usedStorage,
    createdAt,
    updatedAt,
  };
};

export const responsePayload = (res, statusCode = 400, message = "", error) => {
  if (!res)
    throw new Error(
      "response object is not present in params. Make sure that `res` object should pass in the params.",
    );

  const E = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    413: "LIMIT_EXCEED",
  };
  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    error: error || E[statusCode],
  });
};

export const badRequest = (res, message, error = "BadRequest") =>
  res.status(400).json({
    success: false,
    statusCode: 400,
    message,
    error,
  });
export const notFound = (res, message, error = "NotFound") =>
  res.status(404).json({
    success: false,
    statusCode: 404,
    message,
    error,
  });
