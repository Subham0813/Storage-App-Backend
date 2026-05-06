import mongoose from "mongoose";
import crypto from "crypto";

import {
  filenameSchema,
  revokePayloadSchema,
  sharePayloadSchema,
} from "../Schemas/userSchema.js";
import { getErrorObject } from "../utils/helper.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { recursiveRemove } from "../utils/remove.js";
import { restoreDescendants } from "../utils/restore.js";
import { base64URLEncode } from "./oauthControllers.js";
import { User } from "../models/user.model.js";
import { Permission } from "../models/permission.model.js";
import z from "zod";

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
        { _id: req.Item._id, isDeleted: false },
        { name: data.newname },
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
      const { modifiedCount } = await Model.updateOne(
        {
          _id: req.params.id,
          userId: req.user._id,
          isDeleted: false,
          isStarred: !starred,
        },
        { $set: { isStarred: starred } },
      )
        .select("_id isStarred")
        .lean();
      if (modifiedCount === 0)
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
 * what it do: Move a file or directory to a different parent directory, updating ancestors and sizes.
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

      const targetIsChild = req.target.ancestors.some(
        (anc) => anc.toString() === item._id.toString(),
      );

      if (targetIsChild) {
        return next(getErrorObject("Item can not be moved to child.", 403));
      } else if (item.parentId.toString() === target._id.toString()) {
        return next(getErrorObject("Item already exists in the target.", 409));
      } else if (
        parseInt(item.size) >
        target.userId.maxQuota - target.userId.root.size
      ) {
        return next(
          getErrorObject(
            "Can not perform operation due to insufficient quota.",
          ),
        );
      }

      const ancestors = [];
      const targetBulkOps = target.ancestors.map((anc) => {
        ancestors.push(anc);
        return {
          updateOne: {
            filter: { _id: target._id },
            update: { $inc: { size: item.size } },
          },
        };
      });
      const itemBulkOps = item.ancestors.map((anc) => ({
        updateOne: {
          filter: { _id: anc, isDeleted: false },
          update: { $inc: { size: -item.size } },
        },
      }));

      if (model === "dir") {
        const descendents = await Directory.find({
          ancestors: { $in: [item._id] },
        })
          .select("_id ancestors")
          .lean();

        if (descendents.length > 0) {
          // update descendants
          const descOps = descendents.map((d) => {
            const oldParentIdx = d.ancestors.findIndex(
              (a) => a.toString() === item._id.toString(),
            );
            const descNewAncestors = [
              ...ancestors,
              ...d.ancestors.slice(oldParentIdx + 1),
            ];
            return {
              updateOne: {
                filter: { _id: d._id },
                update: { ancestors: descNewAncestors },
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
                ancestors: target.ancestors,
              },
            },
            { session },
          );
          await Directory.bulkWrite([...targetBulkOps, ...itemBulkOps], {
            session,
          });
        });
      } catch (dbErr) {
        throw getErrorObject("Database error.", 500, dbErr);
      } finally {
        await session.endSession();
      }

      return res.status(200).json({
        success: true,
        message: "Item moved to the target directory.",
        data: {
          item: { _id: req.params.id, parentId: req.body.targetId },
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
    const Model =
      model === "file" ? UserFile : model === "dir" ? Directory : null;

    if (!Model) next("No `model` param found.");
    if (!mongoose.isValidObjectId(req.params.id))
      return next(getErrorObject("Invalid id."));

    try {
      const item = await Model.findOne({ _id: req.params.id, isDeleted: false })
        .select("userId parentId publicRole ancestors size")
        .lean();

      if (!item) return next(getErrorObject("Item not found.", 404));

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
              },
            },
            { session, returnDocument: "after" },
          )
            .select("_id parentId isDeleted")
            .lean();

          // decrement all ancestor sizes
          if (item.size > 0 && item.ancestors.length > 0) {
            await Directory.updateMany(
              { _id: { $in: item.ancestors } },
              { $inc: { size: -item.size } },
              { session },
            );
          }

          if (model === "dir") {
            await recursiveRemove(item._id, session);
          }
        });
      } finally {
        await session.endSession();
      }

      res.status(200).json({
        success: true,
        message: "Item moved to bin.",
        data: {
          item: {
            _id: req.params.id,
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
        deletedBy: "user",
      })
        .populate({
          path: "parentId",
          select: "_id",
          match: { isDeleted: false },
        })
        .select("userId publicRole sharedWith parentId size")
        .lean();

      if (!item) return next(getErrorObject(`Item not found.`, 404));
      if (!item.parentId || !item.parentId._id)
        return next(getErrorObject("Restore parent first."));

      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          await Model.findOneAndUpdate(
            { _id: item._id },
            { $set: { isDeleted: false, deletedBy: "none", deletedAt: null } },
            { session, returnDocument: "after" },
          )
            .select("_id ancestors parentId isDeleted")
            .lean();

          // increment all ancestor sizes back
          if (item.size > 0 && item.ancestors.length > 0) {
            await Directory.updateMany(
              { _id: { $in: item.ancestors } },
              { $inc: { size: item.size } },
              { session },
            );
          }

          if (model === "dir") {
            await restoreDescendants(item._id, session);
          }
        });
      } finally {
        await session.endSession();
      }

      return res.status(200).json({
        success: true,
        message: "Item restored.",
        data: {
          item: {
            _id: req.params.id,
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

// export const changePublicRole = (model) => {
//   return async (req, res, next) => {
//     const Model =
//       model === "file" ? UserFile : model === "dir" ? Directory : null;
//     if (!Model) next("No `model` param found.");
//     if (!mongoose.isValidObjectId(req.params.id))
//       return next(getErrorObject("Invalid id."));

//     const formattedRole = req.body?.publicRole
//       ? String(req.body.publicRole).toLowerCase()
//       : undefined;

//     if (
//       !formattedRole ||
//       !["view", "none"].includes(formattedRole)
//       // || typeof inheritShare !== "boolean"
//     )
//       return next(getErrorObject("Invalid payload."));

//     const query = { $set: { "publicRole.role": formattedRole } };
//     const session = await mongoose.startSession();
//     let updated = null;
//     try {
//       await session.withTransaction(async () => {
//         const item = await Model.findOne({
//           _id: req.params.id,
//           userId: req.user._id,
//           isDeleted: false,
//         })
//           .select("_id userId publicRole shareToken")
//           .populate("parentId", "_id shareToken")
//           .session(session)
//           .lean();

//         if (!item) {
//           throw getErrorObject("Item not found.", 404);
//         } else if (item.userId.toString() !== req.user._id.toString()) {
//           throw getErrorObject("You do not have this permission.", 403);
//         } else if (item.publicRole === formattedRole)
//           throw getErrorObject("Item already exists with same access.", 409);

//         if (formattedRole !== "none" && !item.shareToken) {
//           query.$set.shareToken = base64URLEncode(crypto.randomBytes(32));
//           query.$set.sharedAt = new Date();
//         }

//         updated = await Model.findOneAndUpdate({ _id: item._id }, query, {
//           session,
//         }).select("_id publicRole shareToken");

//         if (model === "dir") {
//           await UserFile.updateMany(
//             { parentId: item._id, isDeleted: false },
//             query,
//             { session },
//           );
//         }
//       });

//       return res.status(201).json({
//         success: true,
//         message: "Public permission changed.",
//         data: { item: updated },
//       });
//     } catch (err) {
//       next(err);
//     } finally {
//       await session.endSession();
//     }
//   };
// };

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

    const { emailsWithRole, notify, message, publicRole } = data; // e.g., [{ email: "a@a.com", role: "edit" }]
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // 1. Verify item ownership
        const item = await Model.findOne({
          _id: req.params.id,
          userId: req.user._id,
          isDeleted: false,
        })
          .select("_id publicRole")
          .session(session)
          .lean();

        if (!item)
          throw getErrorObject(
            "Directory does not exist or you do not have permission.",
            404,
          );

        // 2. Find matching users in the DB by email
        const emails = emailsWithRole.filter((e) => e.email !== req.user.email);
        if (emails && emails.length > 0) {
          const targetUsers = await User.find({ email: { $in: emails } })
            .select("_id email")
            .session(session)
            .lean();

          if (targetUsers.length > 0) {
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
          }
        }

        // 4. Update the item's shareToken/sharedAt status
        if (publicRole) {
          const query = {
            $set: {
              "publicRole.role": publicRole,
              "publicRole.sharedAt": new Date(),
            },
          };
          if (!item.publicRole?.shareToken) {
            query.$set["publicRole.shareToken"] = base64URLEncode(
              crypto.randomBytes(32),
            );
          }
          await Model.updateOne({ _id: item._id }, query, { session });
        }
      });

      return res.status(200).json({
        success: true,
        message: `Item shared successfully.`,
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

    const { emails, publicRole } = data;
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const item = await Model.findOne({
          _id: req.params.id,
          userId: req.user._id,
          isDeleted: false,
        })
          .select("_id")
          .session(session)
          .lean();

        if (!item) throw getErrorObject("Item not found.", 404);

        // 1. Delete the Permission records for these specific users
        if (emails && emails.length > 0) {
          const targetUsers = await User.find({ email: { $in: emails } })
            .select("_id")
            .session(session)
            .lean();
          const targetUserIds = targetUsers.map((u) => u._id);

          if (targetUserIds.length > 0) {
            await Permission.deleteMany({
              itemId: item._id,
              userId: { $in: targetUserIds },
            }).session(session);
          }
        }

        // 2. Handle Public Link revocation if provided
        if (publicRole) {
          const updateQuery = { $set: { "publicRole.role": publicRole } };
          if (publicRole === "none") {
            updateQuery.$set["publicRole.sharedAt"] = null;
            updateQuery.$set["publicRole.shareToken"] = null;
          }
          await Model.updateOne({ _id: item._id }, updateQuery, { session });
        }
      });

      return res.status(200).json({
        success: true,
        message: "Permissions revoked.",
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

    const shareToken = base64URLEncode(crypto.randomBytes(32));
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const { modifiedCount } = await Model.updateOne(
          { _id: req.params.id, userId: req.user._id, isDeleted: false },
          { $set: { "publicRole.shareToken": shareToken } },
          { session },
        );

        if (modifiedCount === 0) throw getErrorObject("item not found.", 404);
      });

      return res.status(201).json({
        success: true,
        data: { item: { _id: req.params.id, newToken: shareToken } },
      });
    } catch (err) {
      next(err);
    } finally {
      session.endSession();
    }
  };
};
