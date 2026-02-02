import mongoose from "mongoose";
import { Router } from "express";
import { User } from "../models/user.model.js";
import { badRequest, notFound } from "../utils/helper.js";
import { Directory } from "../models/directory.model.js";
import { Session } from "../models/session.model.js";
import { UserFile } from "../models/user_file.model.js";
import { UploadSession } from "../models/uploadSession.model.js";
import { DriveIntegration } from "../models/integration.model.js";

export const router = Router();

router.get("/all-users", async (req, res, next) => {
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
});

router.get("/all-deleted-users", async (req, res, next) => {
  try {
    const users = await User.find({ isDeleted: true }).lean();
    return res.status(200).json({ success: true, data: { users } });
  } catch (err) {
    next(err);
  }
});

router.get("/user/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(id)) return badRequest(res, "Invalid id.");

    const user = User.findById(id).lean();
    if (!user) return notFound(res, "User not found.");

    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

//super-admins can only read super-admins
router.get("/directory/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(id)) return badRequest(res, "Invalid id.");

    const directory = await Directory.findOne({
      _id: id,
      isDeleted: false,
    }).lean();
    if (!directory) return notFound(res, "directory not found.");

    const files = await UserFile.find({
      parentId: directory._id,
      userId: directory.userId,
    });

    const directories = await Directory.find({
      parentId: directory._id,
      userId: directory.userId,
    });

    const user = User.findById(directory.userId).lean();
    if (user.role === "SUPER_ADMIN" && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: "You don't have this permission.",
        error: "ACCESS_DENIED",
      });

    return res
      .status(200)
      .json({
        success: true,
        data: { directory, children: { directories, files } },
      });
  } catch (err) {
    next(err);
  }
});

//super-admin can only assign new super-admin role
router.patch("/change-role/:id", async (req, res, next) => {
  try {
    let role = req.body || req.query;
    role = role.toUpperCase();

    const allowdRoles = ["GUEST", "USER", "ADMIN", "SUPER_ADMIN"];
    if (!role || !allowdRoles.includes(role))
      return badRequest(res, "Invalid role.");

    if (!mongoose.isValidObjectId(id) || id === req.user._id.toSting())
      return badRequest(res, "Invalid id.");

    if (role === "SUPER_ADMIN" && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: "You don't have this permission.",
        error: "ACCESS_DENIED",
      });

    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { role },
      { new: true },
    ).lean();
    if (!user) return notFound(res, "User not found.");

    return res.status(200).json({
      success: true,
      message: "User permissions changed.",
      data: { user },
    });
  } catch (err) {
    next(err);
  }
});

//super-admin can only logout super-admin
router.post("/logout-user/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return badRequest(res, "Invalid id.");

    if (user.role === "SUPER_ADMIN" && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: "You don't have this permission.",
        error: "ACCESS_DENIED",
      });

    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { isLogged: false },
      { new: true },
    );
    if (!user) return notFound(res, "User not found.");

    await Session.deleteOne({ userId: id });

    return res
      .status(200)
      .json({ success: true, message: "User logged out.", data: { user } });
  } catch (err) {
    next(err);
  }
});

//super-admin only can temp delete super-admin
router.post("/delete-user/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return badRequest(res, "Invalid id.");

    if (user.role === "SUPER_ADMIN" && req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: "You don't have this permission.",
        error: "ACCESS_DENIED",
      });

    const user = await User.findOneAndUpdate(
      { _id: id, isDeleted: false },
      { isLogged: false, isDeleted: true },
      { new: true },
    );
    if (!user) return notFound(res, "User not found.");

    await Session.deleteOne({ userId: id });

    return res
      .status(200)
      .json({ success: true, message: "User deleted.", data: { user } });
  } catch (err) {
    next(err);
  }
});

//super-admin only
router.post("/recover-user/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return badRequest(res, "Invalid id.");

    if (req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: "You don't have this permission.",
        error: "ACCESS_DENIED",
      });

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
});

//super-admin only
router.delete("/remove-user/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return badRequest(res, "Invalid id.");

    if (req.user.role !== "SUPER_ADMIN")
      return res.status(403).json({
        success: false,
        statusCode: 403,
        message: "You don't have this permission.",
        error: "ACCESS_DENIED",
      });

    const user = await User.findOneAndDelete({ _id: id });
    if (!user) return notFound(res, "User not found.");

    await Directory.deleteMany({ userId: id });
    await DriveIntegration.deleteMany({ userId: id });
    await Session.deleteMany({ userId: id });
    await UserFile.deleteMany({ userId: id });
    await UploadSession.deleteMany({ userId: id });

    return res.status(200).json({
      success: true,
      message: "User deleted and can not be recovered anymore.",
      data: { user },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
