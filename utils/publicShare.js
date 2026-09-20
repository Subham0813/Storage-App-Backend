import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { User } from "../models/user.model.js";
import { Permission } from "../models/permission.model.js";
import { PLAN_DETAILS, t } from "../misc/constants.js";

const FREE_PUBLIC_SHARE_CAP = PLAN_DETAILS.FREE.maxPublicShareBytes;

/**
 * Sum the size of every active public item owned by the user (files + folders).
 * "Active" = publicRole "view", not soft-deleted, and no token expiry (or not
 * yet expired). Trashed items are excluded since they're no longer reachable.
 */
export const getActivePublicBytes = async (userId) => {
  const [fileAgg, dirAgg] = await Promise.all([
    UserFile.aggregate([
      {
        $match: {
          userId,
          publicRole: "view",
          isDeleted: false,
          $or: [
            { shareTokenExpiresAt: null },
            { shareTokenExpiresAt: { $gt: new Date() } },
          ],
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$size", 0] } } } },
    ]),
    Directory.aggregate([
      {
        $match: {
          userId,
          publicRole: "view",
          isDeleted: false,
          $or: [
            { shareTokenExpiresAt: null },
            { shareTokenExpiresAt: { $gt: new Date() } },
          ],
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$size", 0] } } } },
    ]),
  ]);

  return (fileAgg[0]?.total || 0) + (dirAgg[0]?.total || 0);
};

/**
 * When a user drops to the FREE plan with active public bytes over the FREE
 * cap, arm a grace period so they can self-serve (unshare / re-upload below
 * the cap). At the end of the grace period a reaper auto-revokes the overflow.
 *
 * The public-share window is always the FREE plan's own 7 days regardless of
 * the plan the user came from: link revocation is non-destructive and
 * reversible (files are never touched), unlike the data grace that protects
 * stored files. `graceDays` is optional and defaults to FREE's grace.
 *
 * Returns true if the grace period was armed (i.e. the user is over the cap),
 * false otherwise.
 */
export const startPublicShareGraceIfNeeded = async (userId, graceDays) => {
  if (!Number.isFinite(FREE_PUBLIC_SHARE_CAP)) return false;

  const activeBytes = await getActivePublicBytes(userId);
  if (activeBytes <= FREE_PUBLIC_SHARE_CAP) return false;

  const days =
    Number.isFinite(graceDays) && graceDays > 0
      ? graceDays
      : PLAN_DETAILS.FREE.gracePeriod || 7;
  await User.updateOne(
    { _id: userId },
    { $set: { publicShareGraceEndsAt: new Date(Date.now() + days * t._day) } },
  );
  return true;
};

/**
 * Revoke public-link access on the given item ids: drop the public role,
 * clear the share token/expiry fields, and fall back to "shared"/"private"
 * access level depending on whether collaborator permissions remain.
 *
 * Returns the ObjectIds of the items that were actually revoked.
 */
export const revokePublicLinks = async (userId, itemIds) => {
  const ids = itemIds.map((id) => id.toString());
  if (ids.length === 0) return [];

  const revokeFor = async (Model) => {
    const items = await Model.find({
      _id: { $in: ids },
      userId,
      publicRole: "view",
    })
      .select("_id")
      .lean();

    const objectIds = items.map((i) => i._id);
    if (objectIds.length === 0) return [];

    await Model.updateMany(
      { _id: { $in: objectIds } },
      {
        $set: {
          publicRole: "none",
          shareToken: null,
          shareTokenExpiresAt: null,
          sharedAt: null,
          publicBy: null,
        },
      },
    );

    // accessLevel falls back to "shared" while collaborator permissions
    // remain, and to "private" once nothing is shared at all.
    const permissionCounts = await Permission.aggregate([
      { $match: { itemId: { $in: objectIds } } },
      { $group: { _id: "$itemId", count: { $sum: 1 } } },
    ]);
    const sharedIds = new Set(permissionCounts.map((p) => p._id.toString()));

    await Model.updateMany(
      { _id: { $in: objectIds }, accessLevel: { $ne: "private" } },
      { $set: { accessLevel: "private" } },
    );
    const stillShared = objectIds.filter((id) => sharedIds.has(id.toString()));
    if (stillShared.length > 0) {
      await Model.updateMany(
        { _id: { $in: stillShared } },
        { $set: { accessLevel: "shared" } },
      );
    }

    return objectIds;
  };

  const [files, dirs] = await Promise.all([
    revokeFor(UserFile),
    revokeFor(Directory),
  ]);

  return [...files, ...dirs];
};

/**
 * Revoke the oldest-shared public items of a user until their active public
 * bytes drop at or below `capBytes`. Used by the grace-period reaper. Never
 * revokes an item that is referenced by the list of ineligible ids (not used
 * today but kept as an escape hatch such as "keep the largest/hottest link").
 *
 * Returns the ids of the revoked items.
 */
export const revokePublicLinksOverCap = async (userId, capBytes) => {
  const [files, dirs] = await Promise.all([
    UserFile.find({
      userId,
      publicRole: "view",
      isDeleted: false,
    })
      .select("_id size sharedAt")
      .sort({ sharedAt: 1, _id: 1 })
      .lean(),
    Directory.find({
      userId,
      publicRole: "view",
      isDeleted: false,
    })
      .select("_id size sharedAt")
      .sort({ sharedAt: 1, _id: 1 })
      .lean(),
  ]);

  const candidates = [...files, ...dirs].sort((a, b) => {
    const aTime = a.sharedAt ? new Date(a.sharedAt).getTime() : 0;
    const bTime = b.sharedAt ? new Date(b.sharedAt).getTime() : 0;
    return aTime - bTime;
  });

  let running = await getActivePublicBytes(userId);
  const toRevoke = [];
  for (const item of candidates) {
    if (running <= capBytes) break;
    toRevoke.push(item._id);
    running -= Number(item.size) || 0;
  }

  return revokePublicLinks(userId, toRevoke);
};