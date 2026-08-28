import mongoose from "mongoose";
import crypto from "crypto";

import {
  filenameSchema,
  revokePayloadSchema,
  sharePayloadSchema,
} from "../schemas/userSchema.js";
import {
  attachPermissionsCount,
  getErrorObject,
  getFileDoc,
  getUserLimits,
} from "../utils/helper.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { recursiveRemove } from "../utils/remove.js";
import { restoreDescendants } from "../utils/restore.js";
import { base64URLEncode } from "./oauthControllers.js";
import { User } from "../models/user.model.js";
import { Permission } from "../models/permission.model.js";
import { sendBulkSharingNotifications } from "../services/emailService.js";
import { notifyMany } from "../services/notificationService.js";
import z from "zod";
import { redisClient } from "../configs/redis.js";
import { PLAN_DETAILS, t } from "../misc/constants.js";

/**
 * path: /api/files/rename/:id or /api/directories/rename/:id
 * what it do: Rename a file or directory.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.params: { id: string }
 *   - req.body: { newname: string }
 *   - req.Item: item object populated by `checkAccess` middleware
 */
export const renameItem = (model) => {
  return async (req, res, next) => {
    try {
      const Model =
        model === "file" ? UserFile : model === "dir" ? Directory : null;

      if (!Model) next("No `model` param found.");
      if (!mongoose.isValidObjectId(req.params.id))
        return next(getErrorObject("Invalid id."));

      const renameSchema = z.object({ newname: filenameSchema.shape.name });
      const { success, data, error } = renameSchema.safeParse(req.body);
      if (!success) return next(getErrorObject(error.issues[0].message));

      const { modifiedCount } = await Model.updateOne(
        { _id: req.Item._id, userId: req.user._id, isDeleted: false },
        {
          name: data.newname,
          lastModifiedBy: req.user._id,
        },
      );
      if (modifiedCount === 0)
        return next(getErrorObject("Item not found.", 404));

      return res.status(200).json({
        success: true,
        data: { item: { _id: req.Item._id, name: data.newname } },
      });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/files/starred/:id or /api/directories/starred/:id
 * what it do: Toggle the starred state of a file or directory.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.params: { id: string }
 *   - req.body: { starred: boolean }
 *   - req.user: authenticated user object
 */
export const starredItem = (model) => {
  return async (req, res, next) => {
    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;

    if (!Model) next("No `model` param found.");
    if (!mongoose.isValidObjectId(req.params.id))
      return next(getErrorObject("Invalid id."));

    const { starred } = req.body;
    if (typeof starred !== "boolean")
      return next(getErrorObject("Invalid payload."));

    try {
      const item = await Model.findOneAndUpdate(
        {
          _id: req.params.id,
          userId: req.user._id,
          isDeleted: false,
          isStarred: !starred,
        },
        {
          $set: { isStarred: starred },
          lastModifiedBy: req.user._id,
        },
      );
      if (!item)
        return next(
          getErrorObject(
            `Item not found or already ${starred ? "starred" : "non-starred"}.`,
          ),
        );

      return res.status(200).json({
        success: true,
        message: "Properties changed.",
        data: { item: { _id: req.params.id, isStarred: starred } },
      });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/files/move/:id or /api/directories/move/:id
 * what it do: Move a file or directory to a different parent directory, updating path and sizes.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.params: { id: string }
 *   - req.body: { targetId: string }
 *   - req.Item: source item populated by `checkAccess` middleware
 *   - req.target: destination directory populated by `loadParentDir` middleware
 */
export const moveItem = (model) => {
  return async (req, res, next) => {
    try {
      const Model =
        model === "file" ? UserFile : model === "dir" ? Directory : null;

      if (!Model) next("No `model` param found.");

      const target = req.target;
      const item = req.Item;

      const targetIsChild = req.target.path.some(
        (anc) => anc.toString() === item._id.toString(),
      );

      if (targetIsChild) {
        return next(getErrorObject("Item can not be moved to child.", 403));
      } else if (item.parentId.toString() === target._id.toString()) {
        return next(getErrorObject("Item already exists in the target.", 409));
      } else {
        const targetLimits = getUserLimits(target.userId);
        if (
          targetLimits.maxStorage !== Infinity &&
          parseInt(item.size) > targetLimits.maxStorage - (target.userId.root?.size || 0)
        ) {
          return next(
            getErrorObject(
              "Can not perform operation due to insufficient quota.",
            ),
          );
        }
      }

      const path = [];
      const targetBulkOps = target.path.map((anc) => {
        path.push(anc);
        return {
          updateOne: {
            filter: { _id: anc, isDeleted: false },
            update: {
              $inc: { size: item.size },
              lastModifiedBy: target.userId._id,
            },
          },
        };
      });

      const itemBulkOps = item.path.map((anc) => {
        return {
          updateOne: {
            filter: { _id: anc, isDeleted: false },
            update: {
              $inc: { size: -item.size },
              lastModifiedBy: target.userId._id,
            },
          },
        };
      });

      if (model === "dir") {
        const descendents = await Directory.find({
          path: { $in: [item._id] },
        })
          .select("_id path")
          .lean();

        if (descendents.length > 0) {
          // update descendants
          const descOps = descendents.map((d) => {
            const oldParentIdx = d.path.findIndex(
              (a) => a.toString() === item._id.toString(),
            );
            const descNewAncestors = [
              ...path,
              ...d.path.slice(oldParentIdx + 1),
            ];
            return {
              updateOne: {
                filter: { _id: d._id },
                update: {
                  path: descNewAncestors,
                  lastModifiedBy: target.userId._id,
                },
              },
            };
          });

          itemBulkOps.push(...descOps);
        }
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await Model.updateOne(
            { _id: item._id },
            {
              $set: {
                parentId: target._id,
                path: target.path,
                lastModifiedBy: target.userId._id,
              },
            },
            { session },
          );
          await Directory.bulkWrite([...itemBulkOps, ...targetBulkOps], {
            session,
          });
        });
      } catch (dbErr) {
        return next(dbErr);
      } finally {
        await session.endSession();
      }

      const itemUserKey = `storageApp:user:${item.userId.toString()}:userdata`;
      const targetUserKey = `storageApp:user:${target.userId.toString()}:userdata`;
      await Promise.all([
        redisClient.del(itemUserKey),
        redisClient.del(targetUserKey),
      ]);

      return res.status(200).json({
        success: true,
        message: "Item moved to the target directory.",
        data: {
          item: { id: item._id, parentId: target._id },
        },
      });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/files/trash/:id or /api/directories/trash/:id
 * what it do: Soft-delete a file or directory (move to bin). For directories, recursively soft-deletes all descendants.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.params: { id: string }
 *   - req.user: authenticated user object
 */
export const moveToBin = (model) => {
  return async (req, res, next) => {
    try {
      const Model =
        model === "file" ? UserFile : model === "dir" ? Directory : null;

      if (!Model) next("No `model` param found.");
      if (!mongoose.isValidObjectId(req.params.id))
        return next(getErrorObject("Invalid id."));

      const item = req.Item;
      const trashRetentionDays =
        req.user.subscription?.limits?.trashRetentionDays ||
        PLAN_DETAILS[req.user.plan].trashRetentionDays;
      const permanentDeleteAt = new Date(
        Date.now() + trashRetentionDays * t._day * 1000,
      );

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await Model.findOneAndUpdate(
            { _id: item._id },
            {
              $set: {
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: "user",
                permanentDeleteAt,
                lastModifiedBy: req.user._id,
              },
            },
            { session, returnDocument: "after" },
          )
            .select("_id parentId isDeleted")
            .lean();

          // decrement all ancestor sizes
          if (item.size > 0 && item.path.length > 0) {
            await Directory.updateMany(
              { _id: { $in: item.path.slice(1) } },
              { $inc: { size: -item.size }, lastModifiedBy: req.user._id },
              { session },
            );
          }

          if (model === "dir") {
            await recursiveRemove(item._id, session, permanentDeleteAt);
          }
        });
      } catch (dbErr) {
        return next(dbErr);
      } finally {
        await session.endSession();
      }

      const itemUserKey = `storageApp:user:${item.userId.toString()}:userdata`;
      await redisClient.del(itemUserKey);

      res.status(200).json({
        success: true,
        message: "Item moved to bin.",
        data: {
          item: {
            id: req.params.id,
            parentId: item.parentId,
            isDeleted: true,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/files/restore/:id or /api/directories/restore/:id
 * what it do: Restore a soft-deleted file or directory from the bin. For directories, recursively restores all process-deleted descendants.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.params: { id: string }
 *   - req.user: authenticated user object
 *   - Parent directory must not be deleted
 */
export const restoreItem = (model) => {
  return async (req, res, next) => {
    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;

    if (!Model) next("No `model` param found.");
    if (!mongoose.isValidObjectId(req.params.id))
      return next(getErrorObject("Invalid id."));

    try {
      const item = await Model.findOne({
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: true,
        deletedBy: "user",
      })
        .populate({
          path: "parentId",
          select: "_id",
          match: { isDeleted: false },
        })
        .select("path userId publicRole sharedWith parentId name size")
        .lean();

      if (!item) return next(getErrorObject(`Item not found.`, 404));
      if (!item.parentId || !item.parentId._id)
        return next(getErrorObject("Restore parent first."));

      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          await Model.updateOne(
            { _id: item._id },
            {
              $set: {
                isDeleted: false,
                deletedBy: "none",
                deletedAt: null,
                lastModifiedBy: req.user._id,
              },
              $unset: { permanentDeleteAt: "" },
            },
            { session, returnDocument: "after" },
          )
            .select("_id path parentId isDeleted")
            .lean();

          // increment all ancestor sizes back
          if (item.size > 0 && item.path.length > 0) {
            await Directory.updateMany(
              { _id: { $in: item.path.slice(1) } },
              {
                $inc: { size: item.size },
                lastModifiedBy: req.user._id,
              },
              { session },
            );
          }

          if (model === "dir") {
            await restoreDescendants(item._id, session);
          }
        });
      } catch (dbErr) {
        return next(dbErr);
      } finally {
        await session.endSession();
      }

      const itemUserKey = `storageApp:user:${item.userId.toString()}:userdata`;
      await redisClient.del(itemUserKey);

      return res.status(200).json({
        success: true,
        message: "Item restored.",
        data: {
          item: {
            id: req.params.id,
            parentId: item.parentId._id,
            isDeleted: false,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  };
};

/**
 * path: /api/files/share/:id or /api/directories/share/:id
 * what it do: Share an item with specific users by email (upserts Permission records) and/or set a public share link.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.params: { id: string }
 *   - req.body: { emailsWithRole: Array<{email, role}>, publicRole?: string, notify?: boolean, message?: string }
 *   - req.user: authenticated item owner
 */
export const shareAccess = (model) => {
  return async (req, res, next) => {
    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    const onModelType = model === "file" ? "UserFile" : "Directory";

    if (!Model) return next(getErrorObject("No `model` param found.", 400));
    if (!mongoose.isValidObjectId(req.params.id))
      return next(getErrorObject("Invalid id"));

    const { success, data, error } = sharePayloadSchema.safeParse(req.body);
    if (!success) {
      const message = error.issues.map((err) => err.message).join(", ");
      return next(getErrorObject(message));
    }

    const { emailsWithRole, notify, message, publicRole, expiresIn } = data;
    const session = await mongoose.startSession();
    let shareToken = null;
    let item = null;
    let validEmails = null;
    let targetUserIds = [];

    try {
      await session.withTransaction(async () => {
        // 1. Verify item ownership
        item =
          req.Item ||
          (await Model.findOne({
            _id: req.params.id,
            userId: req.user._id,
            isDeleted: false,
          })
            .select("_id name userId publicRole")
            .populate("userId")
            .session(session)
            .lean());

        if (!item) throw getErrorObject("Item does not exist.", 404);
        if (item.userId._id.toString() !== req.user._id.toString()) {
          throw getErrorObject("Only owner can share this item.", 403);
        }
        if (
          publicRole &&
          !req.user.subscription?.limits?.canCreatePublicLinks
        ) {
          throw getErrorObject(
            "Your current plan does not support public link sharing. Please upgrade.",
            403,
          );
        }

        // 2. Find matching users in the DB by email
        const emails =
          emailsWithRole
            ?.filter((e) => e.email !== req.user.email)
            .map((e) => e.email.toLowerCase().trim()) || [];

        const query = { $set: { lastModifiedBy: req.user._id } };

        if (emails && emails.length > 0) {
          const targetUsers = await User.find({ email: { $in: emails } })
            .select("_id email")
            .session(session)
            .lean();

          const foundEmails = new Set(targetUsers.map((u) => u.email));
          const unregisteredEmails = emails.filter((e) => !foundEmails.has(e));
          if (unregisteredEmails.length > 0) {
            throw getErrorObject(
              `No account found for: ${unregisteredEmails.join(
                ", ",
              )}. They need to register before they can be invited to collaborate.`,
              400,
            );
          }

          if (targetUsers.length > 0) {
            validEmails = targetUsers.map((u) => u.email);
            targetUserIds = targetUsers.map((u) => u._id);
            // 3. Prepare Bulk Upsert for the ACL Permission Collection
            const permissionOps = targetUsers.map((tUser) => {
              const userReq = emailsWithRole.find(
                (e) => e.email === tUser.email,
              );

              return {
                updateOne: {
                  filter: { userId: tUser._id, itemId: item._id },
                  update: {
                    $set: {
                      onModel: onModelType,
                      permission: userReq.role,
                      grantedBy: req.user._id,
                    },
                  },
                  upsert: true,
                },
              };
            });

            await Permission.bulkWrite(permissionOps, { session });
            query.$set = {
              accessLevel: "shared",
            };
          }
        }

        // 4. Update the item's shareToken/sharedAt status
        if (publicRole) {
          query.$set = {
            publicRole: publicRole,
            sharedAt: new Date(),
            publicBy: req.user._id,
            accessLevel: "public",
          };

          if (expiresIn) {
            query.$set.shareTokenExpiresAt = new Date(Date.now() + expiresIn);
          } else if (expiresIn === null) {
            query.$set.shareTokenExpiresAt = null;
          }

          if (!item.shareToken) {
            shareToken = base64URLEncode(crypto.randomBytes(32));
            query.$set["shareToken"] = shareToken;
          } else shareToken = item.shareToken;
        }

        if (emails.length < 1 && (!publicRole || publicRole === "none")) {
          throw getErrorObject(
            "No valid share target provided. Provide at least one email or set a public share role.",
          );
        }

        item = await Model.findByIdAndUpdate(item._id, query, {
          session,
          returnDocument: "after",
        });
      });

      // Send sharing notification emails
      if (notify && validEmails && validEmails.length > 0) {
        const itemType = model === "file" ? "file" : "directory";
        const itemName = item.name;
        sendBulkSharingNotifications(
          validEmails,
          itemName,
          itemType,
          req.user.name,
          message,
        ).catch((err) => console.error("Email notification failed:", err));
      }

      notifyMany({
        userIds: targetUserIds,
        type: "share",
        title: "New file shared with you",
        message: `${req.user.name} shared "${item.name}" with you`,
        link: "/shared",
      });

      return res.status(200).json({
        success: true,
        message: `Item shared successfully.`,
        data: {
          id: item._id,
          name: item.name,
          accessLevel: item.accessLevel,
          sharedTo: validEmails,
          publicRole: item.publicRole,
          token: item.shareToken,
        },
      });
    } catch (err) {
      next(err);
    } finally {
      await session.endSession();
    }
  };
};

/**
 * path: /api/files/revoke-access/:id or /api/directories/revoke-access/:id
 * what it do: Revoke permissions for specific users and/or disable the public share link.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.params: { id: string }
 *   - req.body: { emails?: string[], publicRole?: string }
 *   - req.user: authenticated item owner
 */
export const revokeAccess = (model) => {
  return async (req, res, next) => {
    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    if (!Model) return next(getErrorObject("No `model` param found.", 400));
    if (!mongoose.isValidObjectId(req.params.id))
      return next(getErrorObject("Invalid id."));

    const { success, data, error } = revokePayloadSchema.safeParse(req.body);
    if (!success)
      return next(
        getErrorObject(error.issues.map((e) => e.message).join(", ")),
      );

    const { emails: rawEmails, publicRole, notify, message } = data;
    const session = await mongoose.startSession();
    let updatedItem = null;
    let revokedEmails = null;
    let targetUserIds = [];

    try {
      await session.withTransaction(async () => {
        const item =
          req.Item ||
          (await Model.findOne({
            _id: req.params.id,
            userId: req.user._id,
            isDeleted: false,
          })
            .select("_id")
            .session(session)
            .lean());

        if (!item) throw getErrorObject("Item not found.", 404);

        const emails =
          rawEmails?.filter((e) => e !== req.user.email).map((e) => e) || [];

        // 1. Delete the Permission records for these specific users
        const query = { $set: { lastModifiedBy: req.user._id } };
        if (emails && emails.length > 0) {
          const targetUsers = await User.find({
            email: { $in: emails },
          })
            .select("_id emails")
            .session(session)
            .lean();
          targetUserIds = targetUsers.map((u) => u._id);
          revokedEmails = targetUsers.map((u) => u.email);

          if (targetUserIds.length > 0) {
            await Permission.deleteMany({
              itemId: item._id,
              userId: { $in: targetUserIds },
            }).session(session);
          }
        }

        // 2. Handle Public Link revocation if provided}
        if (publicRole) {
          query.$set.publicRole = publicRole;
          query.$set.shareTokenExpiresAt = null;
          query.$set.shareToken = null;
          query.$set.sharedAt = null;
          query.$set.publicBy = null;
        }

        const permissionRemains = await Permission.countDocuments({
          itemId: item._id,
        });
        if (permissionRemains === 0 && publicRole === "none")
          query.$set["accessLevel"] = "private";

        updatedItem = await Model.findByIdAndUpdate(item._id, query, {
          session,
          returnDocument: "after",
        })
          .select("_id name parentId accessLevel publicRole")
          .lean();
      });

      // Send revokation notification emails
      if (notify && revokedEmails && revokedEmails.length > 0) {
        const itemType = model === "file" ? "file" : "directory";
        const itemName = updatedItem?.name;
        sendBulkSharingNotifications(
          revokedEmails,
          itemName,
          itemType,
          req.user.name,
          message,
        ).catch((err) => console.error("Email notification failed:", err));
      }

      notifyMany({
        userIds: targetUserIds,
        type: "share",
        title: "Access removed",
        message: `${req.user.name} removed your access to "${updatedItem?.name}"`,
        link: "/shared",
      });

      return res.status(200).json({
        success: true,
        message: "Permissions revoked.",
        data: { item: getFileDoc(updatedItem), revoked: revokedEmails },
      });
    } catch (err) {
      next(err);
    } finally {
      await session.endSession();
    }
  };
};

/**
 * path: /api/files/new-token/:id or /api/directories/new-token/:id
 * what it do: Regenerate the public share token for an item, invalidating the old share link.
 * requirements:
 *   - model: "file" | "dir"
 *   - req.params: { id: string }
 *   - req.user: authenticated item owner
 */
export const newShareToken = (model) => {
  return async (req, res, next) => {
    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;
    if (!Model) next("No `model` param found.");

    if (!mongoose.isValidObjectId(req.params.id))
      return next(getErrorObject("Invalid id."));

    const { expiresIn } = req.body;
    const shareToken = base64URLEncode(crypto.randomBytes(32));

    const setQuery = { shareToken: shareToken, lastModifiedBy: req.user._id };
    if (expiresIn) {
      setQuery.shareTokenExpiresAt = new Date(Date.now() + expiresIn);
    } else if (expiresIn === null) {
      setQuery.shareTokenExpiresAt = null;
    }

    const session = await mongoose.startSession();
    try {
      const item = await Model.findOne({
        _id: req.params.id,
        userId: req.user._id,
        isDeleted: false,
      })
        .select("_id name parentId")
        .lean();
      if (!item) return next(getErrorObject("item not found.", 404));

      await session.withTransaction(async () => {
        const { modifiedCount } = await Model.updateOne(
          { _id: req.params.id, userId: req.user._id, isDeleted: false },
          { $set: setQuery },
          { session },
        );

        if (modifiedCount === 0) throw getErrorObject("item not found.", 404);
      });

      return res.status(201).json({
        success: true,
        data: { item: { id: req.params.id, newToken: shareToken } },
      });
    } catch (err) {
      next(err);
    } finally {
      session.endSession();
    }
  };
};
