import { User } from "../models/user.model.js";
import { redisClient } from "../configs/redis.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const BANDWIDTH_WINDOW_MS = 30 * DAY_MS;

export const getBandwidthResetAt = () =>
  new Date(Date.now() + BANDWIDTH_WINDOW_MS);

/**
 * Lazily enforce the per-user rolling 30-day bandwidth window.
 * If the user has no reset timestamp (legacy/backfill) or it has expired,
 * zero the usage and push the window forward by 30 days. Uses a guarded
 * DB update so concurrent requests can never double-reset, then mirrors
 * the result onto the in-memory user object and busts the userdata cache.
 */
export const ensureBandwidthWindow = async (user) => {
  if (!user?._id) return user;

  const resetAt = user.bandwidthResetAt
    ? new Date(user.bandwidthResetAt)
    : null;
  if (resetAt && resetAt > new Date()) return user;

  await User.updateOne(
    {
      _id: user._id,
      $or: [
        { bandwidthResetAt: null },
        { bandwidthResetAt: { $lte: new Date() } },
      ],
    },
    {
      $set: {
        usedBandwidthQuota: 0,
        bandwidthResetAt: getBandwidthResetAt(),
      },
    },
  );

  user.usedBandwidthQuota = 0;
  user.bandwidthResetAt = getBandwidthResetAt();

  redisClient
    .del(`storageApp:user:${user._id.toString()}:userdata`)
    .catch(console.error);

  return user;
};
