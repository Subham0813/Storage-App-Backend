import { createReadStream } from "fs";
import crypto from "crypto";

/**
 * Utility: getFileHash
 * Stream a file and compute its cryptographic hash
 */
export const getFileHash = (
  filePath,
  hashAlgo = "sha256",
  digestArg = "hex",
) => {
  return new Promise((resolve, reject) => {
    const rs = createReadStream(filePath);
    const hash = crypto.createHash(hashAlgo);

    rs.on("data", (chunk) => hash.update(chunk));
    rs.on("end", () => resolve(hash.digest(digestArg)));
    rs.on("error", (err) => reject(err));
  });
};

/**
 * Error formatting utility
 */
export const getErrorObject = (
  errMessage = "Server error. Request not fullfiled.",
  statusCode = 400,
) => {
  const err = new Error("");
  err.customMessage = errMessage;
  err.statusCode = statusCode;
  return err;
};

export const badRequest = (res, message) =>
  res.status(400).json({ success: false, message });

export const notFound = (res, message) =>
  res.status(404).json({ success: false, message });

export const forbidden = (res) =>
  res.status(403).json({
    success: false,
    message: "You don't have this permission.",
  });

/**
 * Strip sensitive data from User
 */
export const getUserPayload = (user) => {
  if (!user) return null;
  const userDoc = user._doc || user;
  const { password, __v, ...safeUser } = userDoc;
  return safeUser;
};

/**
 * Strip sensitive data from File
 */
export const getFileDoc = (file) => {
  if (!file) return null;
  const fileDoc = file._doc || file;
  const { key, __v, ...safeFile } = fileDoc;
  return safeFile;
};
