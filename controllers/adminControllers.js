import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { getErrorObject } from "../utils/helper.js";
import { Directory } from "../models/directory.model.js";
import { Session } from "../models/session.model.js";
import { UserFile } from "../models/user_file.model.js";
import { UploadSession } from "../models/uploadSession.model.js";
import { DriveIntegration } from "../models/integration.model.js";
import { File } from "../models/file.model.js";

/**
 * path: /api/admin/users
 * what it do: Get all non-deleted users with their root directories.
 * requirements:
 *   - req.user: authenticated admin user
 *   - Only accessible by ADMIN or SUPER_ADMIN
 */
export const getAllUsers = async (req, res, next) => {
  try {
    const users = await User.find({ isDeleted: false })
      .select("-__v -googleId -githubId")
      .lean();
    return res
      .status(200)
      .json({ success: true, message: "Users found.", data: { users } });
  } catch (err) {
    console.log(err);
    next(err);
  }
};

/**
 * path: /api/admin/deleted-users
 * what it do: Get all deleted users.
 * requirements:
 *   - req.user: authenticated admin user
 *   - Only accessible by ADMIN or SUPER_ADMIN
 */
export const getAllDeletedUsers = async (req, res, next) => {
  try {
    const users = await User.find({ isDeleted: true })
      .select("-__v -googleId -githubId")
      .lean();
    return res
      .status(200)
      .json({ success: true, message: "Users found.", data: { users } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/user/:id
 * what it do: Get a single user by id.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated admin user
 *   - Only accessible by ADMIN or SUPER_ADMIN
 */
export const getSingleUser = async (req, res, next) => {
  try {
    const { uid } = req.params;
    if (!mongoose.isValidObjectId(uid))
      return next(getErrorObject("Invalid id."));

    const user = await User.findById(uid)
      .select("-__v -googleId -githubId")
      .lean();
    if (!user) return next(getErrorObject("User not found."));
    return res
      .status(200)
      .json({ success: true, message: "User found.", data: { user } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/change-role/:id
 * what it do: Change the role of a user.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.body | req.query: { role: string } (GUEST, USER, ADMIN)
 *   - req.user: authenticated admin user
 *   - Only accessible by ADMIN or SUPER_ADMIN
 */
export const changeUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    let requestedRole = req.body.role || req.query.role;
    requestedRole = String(requestedRole).toUpperCase();

    const allowedRoles = ["GUEST", "USER", "ADMIN"];
    if (!requestedRole || !allowedRoles.includes(requestedRole))
      return next(getErrorObject("Invalid role."));

    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return next(getErrorObject("Invalid id."));

    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: false, role: { $ne: req.user.role } },
      { role: requestedRole },
      { returnDocument: "after" },
    );
    if (!user)
      return next(getErrorObject("You don't have this permission.", 409));

    return res.status(201).json({
      success: true,
      message: "User role changed.",
      data: {
        user: { _id: user._id, role: requestedRole },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/logout-user/:id
 * what it do: Log out a user by deleting their sessions.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated admin user
 *   - Only accessible by ADMIN or SUPER_ADMIN
 */
export const logoutUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return next(getErrorObject("Invalid id."));

    const user = await User.findOne({ _id: id, isDeleted: false })
      .select("_id role")
      .lean();
    if (!user) return next(getErrorObject("User not found.", 404));

    if (user.role === req.user.role || user.role === "SUPER_ADMIN")
      return next(getErrorObject("You don't have this permission.", 409));

    await Session.deleteMany({ userId: user._id });
    return res.status(200).json({
      success: true,
      message: "User logged out. Session deleted.",
      data: { user },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/remove-user/:id
 * what it do: Soft-delete a user (can be recovered).
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated admin user
 *   - Only accessible by ADMIN or SUPER_ADMIN
 */
export const tempRemoveUser = async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
    return next(getErrorObject("Invalid id."));

  try {
    const user = await User.findOne({
      _id: id,
      isDeleted: false,
      role: { $ne: req.user.role },
    });

    if (!user) return next(getErrorObject("User not found.", 404));
    if (user.role === "SUPER_ADMIN")
      return next(getErrorObject("You don't have this permission.", 409));

    const session = await mongoose.startSession();
    let updated = null;
    try {
      await session.withTransaction(async () => {
        updated = await User.findByIdAndUpdate(
          user._id,
          { isDeleted: true },
          { session, returnDocument: "after" },
        )
          .select("_id isDeleted")
          .lean();
        await Session.deleteMany({ userId: user._id }).session(session);
      });
    } finally {
      await session.endSession();
    }

    return res.status(200).json({
      success: true,
      message: "User banned.",
      data: { user: updated },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/recover-user/:id
 * what it do: Recover a soft-deleted user. Only SUPER_ADMIN can recover.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated SUPER_ADMIN user
 */
export const recoverUser = async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
    return next(getErrorObject("Invalid id."));
  if (req.user.role !== "SUPER_ADMIN")
    return next(getErrorObject("You don't have this permission.", 409));

  try {
    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: true },
      { isDeleted: false },
      { returnDocument: "after" },
    )
      .select("_id isDeleted")
      .lean();
    if (!user) return next(getErrorObject("User not found.", 404));

    return res
      .status(200)
      .json({ success: true, message: "User recovered.", data: { user } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/delete-user/:id
 * what it do: Permanently delete a user and all their data. Only SUPER_ADMIN can delete.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.user: authenticated SUPER_ADMIN user
 */
export const deleteUser = async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
    return next(getErrorObject("Invalid id."));

  if (req.user.role !== "SUPER_ADMIN")
    return next(getErrorObject("You don't have this permission.", 409));

  try {
    const user = await User.find({ _id: id }).select("_id").lean();
    if (!user) return next(getErrorObject("User not found.", 404));

    const files = await File.find({ userId: user._id })
      .select("objectKey")
      .lean();

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Directory.deleteMany({ userId: user._id });
        await DriveIntegration.deleteMany({ userId: user._id });
        await Session.deleteMany({ userId: user._id });
        await UserFile.deleteMany({ userId: user._id });
        await UploadSession.deleteMany({ userId: user._id });
        await File.deleteMany({ userId: user._id });
      });
    } finally {
      await session.endSession();
    }

    const filesToDelete = [];
    files.forEach((file) => {
      const filePath = path.join(
        path.resolve(UPLOAD_ROOT),
        user._id.toString(),
        file.objectKey,
      );
      filesToDelete.push(filePath);
    });

    Promise.allSettled(filesToDelete.map((filePath) => unlink(filePath))).then(
      (results) => {
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            console.error(
              `Failed to delete file: ${filesToDelete[index]}`,
              result.reason,
            );
          }
        });
      },
    );

    return res.status(200).json({
      success: true,
      message: "Userdata deleted permanently and no longer available.",
      data: { user },
    });
  } catch (err) {
    next(err);
  }
};
