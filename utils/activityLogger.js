import { ActivityLog } from "../models/activity_log.model.js";

/**
 * Fire-and-forget activity logger.
 * Call after a successful mutation. Errors are swallowed — activity
 * logging must never block or fail the user-facing response.
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.action   – one of ACTIVITY_ACTIONS
 * @param {string} opts.itemType – "file" | "directory"
 * @param {string} opts.itemId
 * @param {string} [opts.parentId]
 * @param {string} [opts.itemName]
 * @param {string} [opts.targetName]
 */
export function logActivity({ userId, action, itemType, itemId, parentId, itemName, targetName }) {
  ActivityLog.create({
    userId,
    action,
    itemType,
    itemId,
    parentId,
    itemName,
    targetName,
  }).catch((err) => console.error("Activity log failed:", err));
}
