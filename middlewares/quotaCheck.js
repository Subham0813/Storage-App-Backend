import { User } from "../models/user.model.js";
import { getErrorObject } from "../utils/helper.js";
import { redisClient } from "../configs/redis.js";
import { createNotification } from "../services/notificationService.js";

/**
 * Middleware to check if user has sufficient quota for upload
 * Attaches user quota info to req.userQuota
 */
export const checkQuotaLimit = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .select("maxQuota root")
      .populate("root", "size")
      .lean();

    if (!user) return next(getErrorObject("User not found.", 404));

    const usedQuota = user.root?.size || 0;
    const maxQuota = user.maxQuota || Infinity;
    const remainingQuota = maxQuota === Infinity ? Infinity : maxQuota - usedQuota;

    req.userQuota = {
      maxQuota,
      usedQuota,
      remainingQuota,
      quotaPercentage: maxQuota === Infinity ? 0 : Math.round((usedQuota / maxQuota) * 100),
    };

    if (req.userQuota.quotaPercentage >= 90) {
      const dedupKey = `storageApp:user:${req.user._id}:notif:storage`;
      const acquired = await redisClient.set(dedupKey, "1", {
        EX: 6 * 3600,
        NX: true,
      });
      if (acquired) {
        createNotification({
          userId: req.user._id,
          type: "storage_warning",
          title: "Storage almost full",
          message: `You've used ${req.userQuota.quotaPercentage}% of your storage`,
          link: "/settings",
        });
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};
