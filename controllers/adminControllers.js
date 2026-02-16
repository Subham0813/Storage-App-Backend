import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { badRequest, forbidden, notFound } from "../utils/helper.js";
import { Directory } from "../models/directory.model.js";
import { Session } from "../models/session.model.js";
import { UserFile } from "../models/user_file.model.js";
import { UploadSession } from "../models/uploadSession.model.js";
import { DriveIntegration } from "../models/integration.model.js";

export const SUPER_ROLES = ["ADMIN", "SUPER_ADMIN"];

export const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({ isDeleted: false })
      .populate("rootDirId")
      .lean();
    console.log(users);

    const flattenUsers = users.map(({ rootDirId, ...rest }) => ({
      user: { ...rest },
      root: rootDirId,
    }));

    return res
      .status(200)
      .json({ success: true, data: { users: flattenUsers } });
  } catch (err) {
    console.log(err);
    next(err);
  }
};

export const getAllDeletedUsers = async (req, res, next) => {
  try {
    const users = await User.find({ isDeleted: true }).lean();
    return res.status(200).json({ success: true, data: { users } });
  } catch (err) {
    next(err);
  }
};

export const getSingleUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badRequest(res, "Invalid id.");

    const user = User.findById(id).lean();
    if (!user) return notFound(res, "User not found.");

    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
};

export const getDirectory = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return badRequest(res, "Invalid id.");

    const directory = await Directory.findOne({
      _id: id,
      isDeleted: false,
    })
      .populate("UserId", "role")
      .lean();
    if (!directory) return notFound(res, "directory not found.");

    const files = await UserFile.find({
      parentId: directory._id,
      userId: directory.userId,
    });

    const directories = await Directory.find({
      parentId: directory._id,
      userId: directory.userId,
    });

    return res.status(200).json({
      success: true,
      data: { directory, children: { directories, files } },
    });
  } catch (err) {
    next(err);
  }
};

export const changeUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    let requestedRole = req.body.role || req.query.role;
    requestedRole = requestedRole.toUpperCase();

    const allowedRoles = ["GUEST", "USER", "ADMIN"];
    if (!requestedRole || !allowedRoles.includes(requestedRole))
      return badRequest(res, "Invalid role.");

    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return badRequest(res, "Invalid id.");

    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: false, role: { $ne: req.user.role } },
      { role: requestedRole },
    );
    if (!user) return forbidden(res);

    return res.status(200).json({
      success: true,
      message: "User permissions changed.",
      data: {},
    });
  } catch (err) {
    next(err);
  }
};

export const logoutUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return badRequest(res, "Invalid id.");

    const user = await User.findOne({ _id: id, isDeleted: false })
      .select("_id role")
      .lean();
    if (!user) return notFound(res, "User not found.");

    if (user.role === req.user.role || user.role === "SUPER_ADMIN")
      return forbidden(res);

    await Session.deleteMany({ userId: user._id });
    return res
      .status(200)
      .json({ success: true, message: "User logged out.", data: { user } });
  } catch (err) {
    next(err);
  }
};

export const tempRemoveUser = async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
    return badRequest(res, "Invalid id.");

  try {
    const user = await User.findOne({
      _id: id,
      isDeleted: false,
      role: { $ne: req.user.role },
    });

    if (!user) return notFound(res, "User not found.");
    if (user.role === "SUPER_ADMIN") return forbidden(res);
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await User.updateOne({ _id: user._id }, { isDeleted: true }).session(
          session,
        );
        await Session.deleteMany({ userId: user._id }).session(session);
      });
    } finally {
      await session.endSession();
    }

    return res
      .status(200)
      .json({ success: true, message: "User deleted.", data: {} });
  } catch (err) {
    next(err);
  }
};

export const recoverUser = async (req, res, next) => {
  if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
    return badRequest(res, "Invalid id.");
  if (req.user.role !== "SUPER_ADMIN") return forbidden(res);

  try {
    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: true },
      { isDeleted: false },
      { new: true },
    );
    if (!user) return notFound(res, "User not found.");

    return res
      .status(200)
      .json({ success: true, message: "User recovered.", data: { user } });
  } catch (err) {
    next(err);
  }
};

export const deleteUser = async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
    return badRequest(res, "Invalid id.");
  if (req.user.role !== "SUPER_ADMIN") return forbidden(res);

  try {
    const user = await User.findOneAndDelete({ _id: id }).select("_id").lean();
    if (!user) return notFound(res, "User not found.");

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Directory.deleteMany({ userId: user._id });
        await DriveIntegration.deleteMany({ userId: user._id });
        await Session.deleteMany({ userId: user._id });
        await UserFile.deleteMany({ userId: user._id });
        await UploadSession.deleteMany({ userId: user._id });
      });
    } finally {
      session.endSession();
    }

    return res.status(200).json({
      success: true,
      message: "User deleted and can not be recovered anymore.",
      data: { user },
    });
  } catch (err) {
    next(err);
  }
};
