import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { getErrorObject, getUserPayload } from "../utils/helper.js";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import {
  sendAccountBannedEmail,
  sendAccountRecoveredEmail,
  sendFeedbackReplyEmail,
  sendAdminDirectEmail,
} from "../services/emailService.js";
import { redisClient } from "../configs/redis.js";
import { deleteS3Objects } from "../services/s3Client.js";
import { IS_SAAS_MODE, PLAN_DETAILS } from "../misc/constants.js";
import { Permission } from "../models/permission.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Feedback } from "../models/feedback.model.js";
import { ActivityLog } from "../models/activity_log.model.js";
import { quotaSchema } from "../schemas/userSchema.js";

/**
 * path: /api/admin/dashboard
 * what it do: Return aggregate stats for the admin dashboard overview.
 * requirements:
 *   - req.user: authenticated admin/super_admin user
 */
export const getDashboardStats = async (req, res, next) => {
  try {
    const limit =
      req.query?.limit > 0 && req.query?.limit <= 100 ? req.query?.limit : 20;

    const [
      totalUsers,
      activeUsers,
      storageResult,
      fileStats,
      planBreakdown,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments({}),

      (async () => {
        const nowSec = Math.floor(Date.now() / 1000);
        return redisClient.zCount(
          "storageApp:active_users",
          nowSec - 60,
          nowSec,
        );
      })(),

      (async () => {
        const roots = await User.distinct("root", { isDeleted: { $ne: true } });
        if (!roots.length) return [];
        return Directory.aggregate([
          { $match: { _id: { $in: roots } } },
          { $group: { _id: null, total: { $sum: "$size" } } },
        ]);
      })(),

      UserFile.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        {
          $group: {
            _id: null,
            totalFiles: { $sum: 1 },
            totalSize: { $sum: "$size" },
          },
        },
      ]),

      User.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: "$plan", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      
      User.find({})
        .select(
          "name email role plan isDeleted lastLogin lastActiveAt createdAt",
        )
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    const storageUsedBytes = storageResult[0]?.total || 0;
    const totalFiles = fileStats[0]?.totalFiles || 0;
    const totalDirs = await Directory.countDocuments({
      isDeleted: { $ne: true },
    });

    const planMap = {
      FREE: "FREE",
      PRO_MONTHLY: "PRO",
      PRO_YEARLY: "PRO",
      BUSINESS_MONTHLY: "BUSINESS",
      BUSINESS_YEARLY: "BUSINESS",
    };

    const aggregated = {};
    let mrrRupees = 0;
    const totalPlanUsers = planBreakdown.reduce((sum, p) => sum + p.count, 0);

    planBreakdown.forEach((p) => {
      const baseKey = planMap[p._id] || p._id;
      if (!aggregated[baseKey]) aggregated[baseKey] = 0;
      aggregated[baseKey] += p.count;

      const detail = PLAN_DETAILS[p._id];
      if (detail && detail.priceInRupees > 0) {
        if (p._id.includes("YEARLY")) {
          mrrRupees += (detail.priceInRupees / 12) * p.count;
        } else {
          mrrRupees += detail.priceInRupees * p.count;
        }
      }
    });

    const planBreakdownFormatted = Object.entries(aggregated).map(
      ([plan, count]) => ({
        plan,
        count,
        percentage:
          totalPlanUsers > 0 ? Math.round((count / totalPlanUsers) * 100) : 0,
      }),
    );

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        storageUsedBytes,
        totalFiles,
        totalDirs,
        mrrRupees: Math.round(mrrRupees),
        planBreakdown: planBreakdownFormatted,
        recentUsers: recentUsers.map((u) => ({
          id: u._id.toString(),
          name: u.name,
          email: u.email,
          plan: u.plan,
          role: u.role,
          isDeleted: u.isDeleted,
          lastLogin: u.lastLogin,
          lastActiveAt: u.lastActiveAt,
          createdAt: u.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/users
 * what it do: Get paginated list of users with search, role, status, and sort filters.
 * requirements:
 *   - req.query: { page?, limit?, search?, role?, status?, sortBy?, sortOrder? }
 *   - req.user: authenticated admin/super_admin user
 */
export const getAllUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query?.page) || 1);
    const lim = parseInt(req.query?.limit);
    const limit = lim > 0 && lim <= 100 ? lim : 20;
    const skip = (page - 1) * limit;

    const search = req.query?.search?.trim();
    const role = req.query?.role?.toLowerCase().trim();
    const status = req.query?.status?.toLowerCase().trim();

    const query = {};

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
      ];
    }

    // status filter (default: "all")
    //   active -> isDeleted = false
    //   banned -> isDeleted = true
    //   "all" / absent -> BOTH active and banned users are returned
    if (status === "banned" || role === "banned") {
      query.isDeleted = true;
    } else if (status === "active") {
      query.isDeleted = false;
    }

    // role filter (default: "all")
    //   specific role -> only users with that role
    //   "all" / absent -> every role; a role filter never narrows the status
    if (role && role !== "banned" && role !== "all") {
      query.role = role;
    }

    // sorting: name / date / plan / role, asc or desc (default newest first)
    const sortOrder = req.query?.sortOrder?.toLowerCase() === "asc" ? 1 : -1;
    const sortFieldMap = {
      name: "name",
      date: "createdAt",
      plan: "plan",
      role: "role",
    };
    const sortField =
      sortFieldMap[req.query?.sortBy?.toLowerCase()] || "createdAt";
    const sort = { [sortField]: sortOrder };

    const findQuery = User.find(query)
      .populate("root")
      .populate("subscription")
      .collation({ locale: "en" })
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const [users, totalCount] = await Promise.all([
      findQuery.lean(),
      User.countDocuments(query),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    const usersData = await Promise.all(
      users.map(async (user) => {
        const indexKey = `storageApp:user:${user._id.toString()}:session_index`;
        const sessionKeys = await redisClient.sMembers(indexKey);

        const payload = await getUserPayload(user);
        payload.sessionCount = sessionKeys.length;
        payload.role = user.role;

        return payload;
      }),
    );

    return res.status(200).json({
      success: true,
      message: "Users found.",
      data: { users: usersData, totalPages, page, totalCount },
    });
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
    if (!mongoose.isValidObjectId(req.params.id))
      return next(getErrorObject("Invalid id."));

    const user = await User.findById(req.params.id)
      .populate("root")
      .populate("subscription")
      .lean();
    if (!user) return next(getErrorObject("User not found."));

    return res.status(200).json({
      success: true,
      message: "User found.",
      data: { user: await getUserPayload(user) },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/change-role/:id
 * what it do: Change the role of a user.
 * requirements:
 *   - req.params: { id: string } (valid Mongo ObjectId)
 *   - req.body | req.query: { role: string } (USER, ADMIN, SUPER_ADMIN)
 *   - req.user: authenticated admin user
 *   - Only accessible by ADMIN or SUPER_ADMIN
 */
export const changeUserRole = async (req, res, next) => {
  try {
    const { id } = req.params;
    let requestedRole = req.body.role || req.query?.role;
    requestedRole = String(requestedRole).toLowerCase();

    if (
      !requestedRole ||
      !["user", "admin", "super_admin"].includes(requestedRole)
    )
      return next(getErrorObject("Invalid role."));

    if (!mongoose.isValidObjectId(id) || id === req.user._id.toString())
      return next(getErrorObject("Invalid id."));

    const target = await User.findById(id).select("role isDeleted").lean();
    if (!target || target.isDeleted)
      return next(getErrorObject("User not found.", 404));

    const requesterRole = req.user.role;

    // Regular admins can only manage regular users and never grant super_admin
    if (requesterRole !== "super_admin") {
      if (target.role !== "user" || requestedRole === "super_admin")
        return next(getErrorObject("You don't have this permission.", 409));
    } else {
      // Super admins can't demote/promote other super admins
      if (target.role === "super_admin")
        return next(getErrorObject("You don't have this permission.", 409));
    }

    const user = await User.findOneAndUpdate(
      { _id: id },
      { role: requestedRole },
      { returnDocument: "after" },
    ).select("_id role");
    if (!user) return next(getErrorObject("User not found.", 404));

    // Invalidate the user's cached payload so new permissions apply immediately
    await redisClient.del(`storageApp:user:${id}:userdata`).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "User role changed.",
      data: { user: { id: user._id.toString(), role: user.role } },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/user/:id/quota
 * what it do: Manually updates a user's quota in Self-Hosted mode.
 * requirements:
 * - req.params: { id: string }
 * - req.user: authenticated ADMIN or SUPER_ADMIN
 */
export const updateUserQuota = async (req, res, next) => {
  try {
    if (req.user.role !== "super_admin" && req.user.role !== "admin") {
      return next(getErrorObject("You don't have this permission.", 409));
    }

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return next(getErrorObject("Invalid user id."));

    const { success, data, error } = quotaSchema.safeParse(req.body);
    if (!success) {
      const message = error.issues.map((e) => e.message).join(", ");
      return next(getErrorObject(message));
    }
    const { maxStorageQuota, maxBandwidthQuota } = data;

    if (IS_SAAS_MODE && (maxStorageQuota > 500e9 || maxBandwidthQuota > 1000e9))
      return next(getErrorObject("Invalid request."));

    const updatePayload = {};
    if (maxStorageQuota) updatePayload.maxQuota = maxStorageQuota;
    if (maxBandwidthQuota) updatePayload.maxBandwidthQuota = maxBandwidthQuota;

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { returnDocument: "after" },
    ).select("_id maxQuota maxBandwidthQuota").lean();

    if (!updatedUser) return next(getErrorObject("User not found.", 404));

    await redisClient.del(`storageApp:user:${id}:userdata`);

    return res.status(200).json({
      success: true,
      message: "User quotas updated successfully.",
      data: { user: updatedUser },
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

  if (req.user.role !== "super_admin" && req.user.role !== "admin")
    return next(getErrorObject("You don't have this permission.", 409));

  try {
    const session = await mongoose.startSession();
    let user = null;

    await session.withTransaction(async () => {
      user = await User.findOne({
        _id: id,
        role: { $nin: ["admin", "super_admin"] },
      }).lean();

      if (!user) throw getErrorObject("You don't have this permission.", 409);

      const indexKey = `storageApp:user:${id}:session_index`;
      const sessions = await redisClient.sMembers(indexKey);
      if (sessions.length > 0) {
        await redisClient.sRem(indexKey, sessions);
        await redisClient.del(sessions);
        await redisClient.del(`storageApp:user:${id}:userdata`);
      }
    });

    await session.endSession();
    return res.status(200).json({
      success: true,
      message: "User logged out and all the user sessions are deleted.",
      data: {
        user: {
          id: user._id.toString(),
          isLogged:
            (await redisClient.sCard(`storageApp:user:${id}:session_index`)) >
            0,
        },
      },
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
  const { reason } = req.body;

  if (!reason || reason.length < 10)
    return next(
      getErrorObject("Reason must be at least 10 characters long.", 400),
    );

  if (!mongoose.isValidObjectId(id)) return next(getErrorObject("Invalid id."));
  if (id === req.user._id.toString())
    return next(getErrorObject("You cannot remove yourself."));

  try {
    let user = await User.findById(id);

    if (!user) return next(getErrorObject("User not found.", 404));
    if (user.isDeleted) return next(getErrorObject("User already banned."));
    if (user.role === req.user.role || user.role === "super_admin")
      return next(getErrorObject("You don't have this permission.", 409));

    user = await User.findOneAndUpdate(
      { _id: user._id },
      {
        $set: {
          isDeleted: true,
          deletedBy: req.user._id,
          deletedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    )
      .select("_id isDeleted name email")
      .lean();

    const indexKey = `storageApp:user:${user._id}:session_index`;
    const sessions = await redisClient.sMembers(indexKey);
    if (sessions.length > 0) {
      await redisClient.sRem(indexKey, sessions);
      await redisClient.del(sessions);
      await redisClient.del(`storageApp:user:${id}:userdata`);
    }

    // Send account banned email
    sendAccountBannedEmail(user.name, user.email).catch((err) =>
      console.error("Email sending failed:", err),
    );

    return res.status(200).json({
      success: true,
      message: "User banned.",
      data: { user: { _id: user._id, isDeleted: user.isDeleted } },
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
      { $set: { isDeleted: false }, $unset: { deletedBy: "", deletedAt: "" } },
      { returnDocument: "after" },
    )
      .select("_id isDeleted name email")
      .lean();
    if (!user) return next(getErrorObject("User not found.", 404));

    // Send account recovered email
    sendAccountRecoveredEmail(user.name, user.email).catch((err) =>
      console.error("Email sending failed:", err),
    );

    return res.status(200).json({
      success: true,
      message: "User recovered.",
      data: { user: { _id: user._id, isDeleted: user.isDeleted } },
    });
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
    const user = await User.findById(id).select("_id avatarKey").lean();
    if (!user) return next(getErrorObject("User not found.", 404));

    const files = await UserFile.find({ userId: user._id })
      .select("key thumbnailKey")
      .lean();

    const v = new Set();
    const th = new Set();
    files.forEach((f) => {
      if (f.key) v.add(f.key);
      if (f.thumbnailKey) th.add(f.thumbnailKey);
    });

    const filesToDelete = Array.from(v);
    const thumbnailsToDelete = Array.from(th);

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Promise.all([
          User.deleteOne({ _id: user._id }).session(session),
          Directory.deleteMany({ userId: user._id }).session(session),
          UserFile.deleteMany({ userId: user._id }).session(session),
          Permission.deleteMany({ userId: user._id }).session(session),
          Subscription.deleteMany({ user: user._id }).session(session),
        ]);
      });
    } finally {
      await session.endSession();
    }

    if (user.avatarKey) {
      await deleteS3Objects([user.avatarKey], true).catch((err) =>
        console.error("S3 Deletion failed:", err),
      );
    }

    if (filesToDelete.length > 0) {
      await deleteS3Objects(filesToDelete).catch((err) =>
        console.error("S3 Deletion failed:", err),
      );
    }

    if (thumbnailsToDelete.length > 0) {
      await deleteS3Objects(thumbnailsToDelete, true).catch((err) =>
        console.error("S3 Deletion failed:", err),
      );
    }

    const indexKey = `storageApp:user:${user._id}:session_index`;
    const sessions = await redisClient.sMembers(indexKey);
    if (sessions.length > 0) {
      await redisClient.sRem(indexKey, sessions);
      await redisClient.del(sessions);
      await redisClient.del(`storageApp:user:${user._id}:userdata`);
    }

    return res.status(200).json({
      success: true,
      message: "User deleted permanently and no longer available.",
      data: { user: { _id: user._id } },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/feedback/:userId
 * what it do: List all feedback submissions for a user (newest first).
 */
export const getUserFeedbacks = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId))
      return next(getErrorObject("Invalid user id."));

    const userExists = await User.exists({ _id: userId });
    if (!userExists) return next(getErrorObject("User not found.", 404));

    const rawLimit = parseInt(req.query?.limit, 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 50)
      : 20;
    const feedbacks = await Feedback.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const data = feedbacks.map((f) => ({
      id: f._id.toString(),
      category: f.category,
      title: f.title,
      description: f.description,
      status: f.status,
      adminNotes: f.adminNotes,
      screenshotUrl: f.screenshotKey
        ? `${process.env.PUBLIC_BUCKET_CDN}/${f.screenshotKey}`
        : null,
      createdAt: f.createdAt,
    }));

    return res.status(200).json({ success: true, data: { feedbacks: data } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/feedback/:feedbackId
 * what it do: Update feedback status and/or admin notes.
 */
export const updateFeedback = async (req, res, next) => {
  try {
    const { feedbackId } = req.params;
    if (!mongoose.isValidObjectId(feedbackId))
      return next(getErrorObject("Invalid feedback id."));

    const { status, adminNotes } = req.body || {};

    if (status === undefined && adminNotes === undefined)
      return next(
        getErrorObject(
          "Provide at least one field: status or adminNotes.",
          400,
        ),
      );

    const update = {};
    if (status !== undefined) {
      if (!["pending", "reviewed", "resolved"].includes(status))
        return next(getErrorObject("Invalid feedback status."));
      update.status = status;
    }
    if (adminNotes !== undefined) {
      if (typeof adminNotes !== "string" || adminNotes.length > 2000)
        return next(
          getErrorObject("adminNotes must be a string under 2000 characters."),
        );
      update.adminNotes = adminNotes;
    }

    const feedback = await Feedback.findByIdAndUpdate(
      feedbackId,
      { $set: update },
      { new: true },
    ).lean();
    if (!feedback) return next(getErrorObject("Feedback not found.", 404));

    return res.status(200).json({
      success: true,
      message: "Feedback updated.",
      data: { feedback },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/feedback/:feedbackId/reply
 * what it do: Email the user a reply to their feedback and mark it resolved.
 */
export const replyToFeedback = async (req, res, next) => {
  try {
    const { feedbackId } = req.params;
    const { message, status } = req.body || {};

    if (!message || message.trim().length < 5)
      return next(
        getErrorObject("Reply message must be at least 5 characters."),
      );
    if (message.trim().length > 5000)
      return next(
        getErrorObject("Reply message cannot exceed 5000 characters."),
      );
    if (!mongoose.isValidObjectId(feedbackId))
      return next(getErrorObject("Invalid feedback id."));

    if (
      status !== undefined &&
      !["pending", "reviewed", "resolved"].includes(status)
    )
      return next(getErrorObject("Invalid feedback status."));

    const feedback = await Feedback.findById(feedbackId).lean();
    if (!feedback) return next(getErrorObject("Feedback not found.", 404));

    const user = await User.findById(feedback.userId)
      .select("name email")
      .lean();
    if (!user) return next(getErrorObject("User not found.", 404));

    await sendFeedbackReplyEmail(user, feedback, message.trim());

    const newStatus = status || "resolved";
    await Feedback.findByIdAndUpdate(feedbackId, {
      $set: { status: newStatus },
    });

    return res.status(200).json({
      success: true,
      message: "Reply emailed to the user.",
      data: { status: newStatus },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/user/:id/email
 * what it do: Send a direct email to a user from the admin.
 */
export const sendUserEmail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subject, message } = req.body || {};

    const cleanSubject = typeof subject === "string" ? subject.trim() : "";
    const cleanMessage = typeof message === "string" ? message.trim() : "";

    if (cleanSubject.length < 3)
      return next(getErrorObject("Subject must be at least 3 characters."));
    if (cleanSubject.length > 200)
      return next(getErrorObject("Subject cannot exceed 200 characters."));
    if (cleanMessage.length < 10)
      return next(getErrorObject("Message must be at least 10 characters."));
    if (cleanMessage.length > 10000)
      return next(getErrorObject("Message cannot exceed 10000 characters."));
    if (!mongoose.isValidObjectId(id))
      return next(getErrorObject("Invalid user id."));

    const user = await User.findById(id).select("name email").lean();
    if (!user) return next(getErrorObject("User not found.", 404));

    if (req.user._id.toString() === user._id.toString())
      return next(getErrorObject("You cannot send an email to yourself.", 400));

    await sendAdminDirectEmail(user, cleanSubject, cleanMessage);

    return res.status(200).json({
      success: true,
      message: "Email sent to the user.",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/admin/user/:id/activity
 * what it do: Recent activity-log entries for a user (newest first).
 */
export const getUserActivity = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id))
      return next(getErrorObject("Invalid user id."));

    const userExists = await User.exists({ _id: id });
    if (!userExists) return next(getErrorObject("User not found.", 404));

    const rawLimit = parseInt(req.query?.limit, 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 50)
      : 20;
    const logs = await ActivityLog.find({ userId: id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const data = logs.map((l) => ({
      id: l._id.toString(),
      action: l.action,
      itemType: l.itemType,
      itemId: l.itemId?.toString(),
      itemName: l.itemName,
      targetName: l.targetName,
      createdAt: l.createdAt,
    }));

    return res.status(200).json({ success: true, data: { activity: data } });
  } catch (err) {
    next(err);
  }
};
