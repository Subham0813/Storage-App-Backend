import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { getErrorObject, getUserPayload } from "../utils/helper.js";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { redisClient } from "../configs/radis.js";
import { deleteS3Objects } from "../configs/s3Client.js";

/**
 * path: /api/admin/users
 * what it do: Get paginated list of non-deleted (or deleted) users.
 * requirements:
 *   - req.query: { limit?: number, cursor?: ObjectId string, isDeleted?: boolean }
 *   - req.user: authenticated admin/super_admin user
 */
export const getAllUsers = async (req, res, next) => {
  let limit = parseInt(req.query.limit);
  if (!limit || limit < 1) limit = 50;
  else if (limit && limit > 100) limit = 100;

  const cursor = req.query.cursor;
  if (cursor && !mongoose.isValidObjectId(cursor))
    return next(getErrorObject("Invalid cursor."));

  const isDeleted = req.query.isDeleted || false;
  if (typeof isDeleted !== "boolean")
    return next(getErrorObject("Invalid query."));

  const query = { isDeleted };
  if (cursor) query._id = { $lt: cursor };

  try {
    const users = await User.find(query)
      .sort({ _id: -1 })
      .limit(limit)
      .select("-__v -googleId -githubId -password")
      .lean();

    const nextCursor =
      users.length < limit ? null : users[limit - 1]._id.toString();

    return res.status(200).json({
      success: true,
      message: "Users found.",
      data: { users, nextCursor },
    });
  } catch (err) {
    console.log(err);
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
    if (!mongoose.isValidObjectId(req.params.id))
      return next(getErrorObject("Invalid id."));

    const user = await User.findById(req.params.id)
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
    requestedRole = String(requestedRole).toLowerCase();

    if (!requestedRole || !["user", "admin"].includes(requestedRole))
      return next(getErrorObject("Invalid role."));

    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return next(getErrorObject("Invalid id."));

    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: false, role: { $ne: req.user.role } },
      { role: requestedRole },
      { returnDocument: "after" },
    )
      .select("_id, role")
      .lean();
    if (!user)
      return next(getErrorObject("You don't have this permission.", 409));

    return res.status(201).json({
      success: true,
      message: "User role changed.",
      data: { user },
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
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return next(getErrorObject("Invalid id."));

  if (id === req.user._id.toString())
    return next(getErrorObject("You cannot logout yourself."));

  if (req.user.role !== "super_admin" || req.user.role !== "admin")
    return next(getErrorObject("You don't have this permission.", 409));

  try {
    const session = await mongoose.startSession();
    const user = null;
    await session.withTransaction(async () => {
      user = User.findOneAndUpdate(
        { _id: id, role: { $nin: ["admin", "super_admin"] } },
        { isLogged: false, deviceCount: 0 },
      ).session(session);

      if (!user) throw getErrorObject("User not found.", 404);

      const indexKey = `storageApp:user:${id}:session_index`;
      const sessions = await redisClient.sMembers(indexKey);
      if (sessions.length > 0) {
        await redisClient.sRem(indexKey, sessions);
        await redisClient.del(sessions);
      }
    });

    const payload = getUserPayload(user);
    return res.status(200).json({
      success: true,
      message: "User logged out and all the user sessions are deleted.",
      data: { user: payload },
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
    let user = await User.findOne({
      _id: id,
      isDeleted: false,
      role: { $ne: req.user.role },
    });

    if (!user) return next(getErrorObject("User not found.", 404));
    if (user.role === "super_admin")
      return next(getErrorObject("You don't have this permission.", 409));

    user = await User.findOneAndUpdate(
      { _id: user._id },
      { isDeleted: true, isLogged: false, deviceCount: 0 },
      { returnDocument: "after" },
    )
      .select("_id isDeleted")
      .lean();

    const indexKey = `storageApp:user:${user._id}:session_index`;
    const sessions = await redisClient.sMembers(indexKey);
    if (sessions.length > 0) {
      await redisClient.sRem(indexKey, sessions);
      await redisClient.del(sessions);
    }

    return res.status(200).json({
      success: true,
      message: "User banned.",
      data: { user },
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
  if (req.user.role !== "super_admin")
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

  if (req.user.role !== "super_admin")
    return next(getErrorObject("You don't have this permission.", 409));

  try {
    const user = await User.find({ _id: id }).select("_id").lean();
    if (!user) return next(getErrorObject("User not found.", 404));

    const files = await UserFile.find({ userId: user._id })
      .select("key size")
      .lean();

    const unique = new Set();
    const filesToDelete = files.filter(({ key, size }) => {
      if (key && !unique.has(key)) return { key, size };
    });

    await deleteS3Objects(filesToDelete);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Promise.all([
          User.deleteOne({ _id: user._id }),
          Directory.deleteMany({ userId: user._id }),
          UserFile.deleteMany({ userId: user._id }),
        ]);
      });
    } finally {
      await session.endSession();
    }

    const indexKey = `storageApp:user:${user._id}:session_index`;
    const sessions = await redisClient.sMembers(indexKey);
    if (sessions.length > 0) {
      await redisClient.sRem(indexKey, sessions);
      await redisClient.del(sessions);
    }

    return res.status(200).json({
      success: true,
      message: "Userdata deleted permanently and no longer available.",
      data: { user },
    });
  } catch (err) {
    next(err);
  }
};
