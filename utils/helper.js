import Directory from "../models/directory.model.js";
import FileModel from "../models/file.model.js";

const getMetadataHelper = (file) => {
  if (!file) return {};
  const metadata = {
    id: file._id,
    parentId: file.parentId,
    name: file.originalname,
    mimetype: file.detectedMime,
    size: file.size,
    isDeleted: file.isDeleted,
    deletedBy: file.deletedBy,
    deletedAt: file.deletedAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
  return metadata;
};

const getFileDocHelper = (file) => ({
  userId: file.userId || null,
  parentId: file.parentId || null,

  originalname: file.originalname,
  filename: file.filename,

  // storage abstraction
  storageProvider: "local",
  objectKey: file.filename, // NOT path

  mimetype: file.mimetype, // informational only
  detectedMime: file.detectedMime || "",
  disposition: file.disposition || "",

  size: file.size,

  isDeleted: false,
  deletedBy: "",
  deletedAt: null,

  createdAt: new Date(),
  updatedAt: new Date(),
});

const getDbData = async (directory) => {
  const directories = await Directory.find(
    { parentId: directory._id, isDeleted: false },
    { name: 1, createdAt: 1, updatedAt: 1 }
  ).lean();

  const files = await FileModel.find(
    { parentId: directory._id, isDeleted: false },
    {
      originalname: 1,
      size: 1,
      detectedMime: 1,
      createdAt: 1,
      updatedAt: 1,
    }
  ).lean();

  return {
    _id: directory._id,
    name: directory.name,
    directories,
    files,
  };
};

const badRequest = (res, message) =>
  res.status(400).json({ success: false, message: message });

const notFound = (res, message) =>
  res.status(404).json({ success: false, message: message });

export {badRequest, notFound, getDbData, getFileDocHelper, getMetadataHelper}