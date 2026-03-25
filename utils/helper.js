import { createReadStream } from "fs";
import crypto from "crypto";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

/**
 * Utility: getFileHash
 * what it do: Stream a file and compute its cryptographic hash (SHA256 by default) to detect duplicates.
 * requirements:
 *   - filePath: absolute path to file
 *   - hashAlgo: algorithm like 'sha256', 'md5' (default: 'sha256')
 *   - digestArg: output format like 'hex' or 'base64url' (default: 'hex')
 *   - Returns: Promise resolving to hash string
 */
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

/**
 * Utility: getFileDoc
 * what it do: Extract and return a subset of file properties for database operations and responses.
 * requirements:
 *   - file: UserFile document with properties to extract
 *   - Returns: object with properties { userId, parentId, meta, name, mimetype, size, ... }
 */
export const getFileDoc = ({
  userId,
  parentId,
  meta,
  linkMeta,
  filename,
  mimetype,
  disposition,
  size,
  inline_preview,
  force_inline_preview,
  isDeleted,
  isStarred,
  deletedAt,
}) => ({
  userId,
  parentId,
  meta,
  linkMeta,
  filename,
  mimetype,
  disposition,
  size,
  inline_preview,
  force_inline_preview,
  isDeleted,
  isStarred,
  deletedAt,
});

/**
 * Utility: getDbData
 * what it do: Recursively fetch a directory with its files and subdirectories, merging file metadata.
 * requirements:
 *   - dirId: directory ObjectId
 *   - dirName: display name of directory
 *   - userId: owner user ObjectId
 *   - isDeleted: boolean to filter by deletion status
 *   - Returns: Promise resolving to object with directories and flattened files
 */
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

/**
 * Utility: getUserPayload
 * what it do: Extract and return safe public user properties for client responses (exclude sensitive data).
 * requirements:
 *   - user: User document with properties to extract
 *   - Returns: object with { _id, name, username, email, deviceCount, usedStorage, ... }
 */
export const getUserPayload = (user) => {
  if (!user) return null;
  const {
    _id,
    name,
    username,
    email,
    isEmailVerified,
    isDriveConnected,
    deviceCount,
    authProviders,
    theme,
    allotedStorage,
    usedStorage,
    root,
    createdAt,
    updatedAt,
    role,
    avatar,
  } = user;

  return {
    _id,
    name,
    username,
    email,
    isEmailVerified,
    isDriveConnected,
    deviceCount,
    authProviders,
    theme,
    allotedStorage,
    usedStorage,
    root,
    createdAt,
    updatedAt,
    role,
    avatar,
  };
};

/**
 * Utility: hasAccess
 * what it do: Check if the provided email has one of the allowed roles on a shared item.
 * requirements:
 *   - item: directory or file document with sharedWith array
 *   - roles: array of role strings to check against (e.g., ['VIEWER', 'EDITOR'])
 *   - email: user email to check access for
 *   - Returns: boolean true if email found with one of the roles
 */
export const hasAccess = (item, roles = [], email) =>
  item.sharedWith.some((sw) => sw.email === email && roles.includes(sw.role));

/**
 * Utility: isDecendent
 * what it do: Check if the provided sourceId and targetId has a decendent relation.
 * requirements:
 *   - sourceId: source directory id (parent)
 *   - targetId: targeted directory id (child)
 *   - Returns: boolean true if sourceId & targetId has descendent relation or false otherwise
 */
export const isDescendent = async (sourceId, targetId) => {
  if (sourceId.toString() === targetId.toString()) return true;

  const children = await Directory.find({
    parentId: sourceId,
    isDeleted: false,
  })
    .select("_id")
    .lean();

  for (const child of children) {
    if (child._id.toString() === targetId.toString()) return true;

    const foundChild = await isDescendent(child._id, targetId);
    if (foundChild) return true;
  }
  return false;
};

/**
 * Utility: responsePayload
 * what it do: Send a standardized error response with appropriate HTTP status and error code.
 * requirements:
 *   - res: Express response object (required)
 *   - statusCode: HTTP status code (default: 400)
 *   - message: error message string (default: '')
 *   - error: optional custom error code (defaults to E[statusCode])
 */
export const responsePayload = (res, statusCode = 400, message = "", error) => {
  if (!res)
    throw new Error(
      "response object is not present in params. Make sure that `res` object should pass in the params.",
    );

  const E = {
    400: "BADREQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOTFOUND",
    409: "CONFLICT",
    413: "LIMITEXCEED",
    429: "TOOMANYREQ",
  };
  res.status(statusCode).json({
    success: false,
    // statusCode,
    message,
    // error: error || E[statusCode],
  });
};

/**
 * Response helper: badRequest (400)
 * what it do: Send a 400 Bad Request error response with message and optional error code.
 * requirements:
 *   - res: Express response object
 *   - message: string describing the error
 *   - error: optional error code/type (defaults to 'BadRequest')
 */
export const badRequest = (res, message) =>
  res.status(400).json({
    success: false,
    // statusCode: 400,
    message,
    // error: "BADREQUEST",
  });

/**
 * Response helper: notFound (404)
 * what it do: Send a 404 Not Found error response with message and optional error code.
 * requirements:
 *   - res: Express response object
 *   - message: string describing what was not found
 *   - error: optional error code/type (defaults to 'NotFound')
 */
export const notFound = (res, message) =>
  res.status(404).json({
    success: false,
    // statusCode: 404,
    message,
    // error: "NOTFOUND",
  });

/**
 * Response helper: forbidden (403)
 * what it do: Send a 403 Forbidden error response when user lacks permission.
 * requirements:
 *   - res: Express response object
 *   - Returns: 403 with message "You don't have this permission." and error code 'FORBIDDEN'
 */
export const forbidden = (res) =>
  res.status(403).json({
    success: false,
    // statusCode: 403,
    message: "You don't have this permission.",
    // error: "FORBIDDEN",
  });
