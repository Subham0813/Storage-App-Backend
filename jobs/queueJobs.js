import { Queue, Worker } from "bullmq";
import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { PLAN_DETAILS } from "../misc/constants.js";
import { redisClient } from "../configs/redis.js";
import { deleteS3Objects } from "../services/s3Client.js";
import {
  sendAbandonedCartEmail,
  sendSubscriptionActionEmail,
} from "../services/emailService.js";
import { createNotification } from "../services/notificationService.js";
import { getBandwidthResetAt } from "../utils/bandwidthWindow.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import connectMongoose from "../configs/connect.js";

const redisConnection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
};

// Recalculates permanentDeleteAt for all trashed files/dirs of a user
// based on their deletedAt timestamp and the new plan's retention days.
const recalculateTrashExpiry = async (userId, trashRetentionDays) => {
  const retentionMs = trashRetentionDays * 24 * 60 * 60 * 1000;
  const trashedItems = await Promise.all([
    UserFile.find({ userId, isDeleted: true, deletedAt: { $exists: true } })
      .select("_id deletedAt")
      .lean(),
    Directory.find({ userId, isDeleted: true, deletedAt: { $exists: true } })
      .select("_id deletedAt")
      .lean(),
  ]);

  const [trashedFiles, trashedDirs] = trashedItems;

  const fileBulkOps = trashedFiles.map((f) => ({
    updateOne: {
      filter: { _id: f._id },
      update: {
        $set: {
          permanentDeleteAt: new Date(f.deletedAt.getTime() + retentionMs),
        },
      },
    },
  }));

  const dirBulkOps = trashedDirs.map((d) => ({
    updateOne: {
      filter: { _id: d._id },
      update: {
        $set: {
          permanentDeleteAt: new Date(d.deletedAt.getTime() + retentionMs),
        },
      },
    },
  }));

  await Promise.all([
    fileBulkOps.length > 0
      ? UserFile.bulkWrite(fileBulkOps)
      : Promise.resolve(),
    dirBulkOps.length > 0 ? Directory.bulkWrite(dirBulkOps) : Promise.resolve(),
  ]);
};

export const backgroundQueue = new Queue("StorageApp-Cron-Queue", {
  connection: redisConnection,
});

let worker = null;
let workerStarted = false;

export const startBullMQWorker = () => {
  if (workerStarted) return worker;
  workerStarted = true;

  worker = new Worker(
    "StorageApp-Cron-Queue",
    async (job) => {
    try {
      const now = new Date();
      switch (job.name) {
        case "downgrade-executor":
          // console.log("Running Downgrade Executor...");
          const pendingDowngrades = await Subscription.find({
            status: "downgrade_requested",
            currentPeriodEnd: { $lte: now },
          });

          for (const sub of pendingDowngrades) {
            const newPlan = PLAN_DETAILS[sub.planKey];

            const userDoc = await User.findByIdAndUpdate(sub.user, {
              plan: sub.planKey,
              maxQuota: newPlan.quotaBytes,
              maxBandwidthQuota: newPlan.monthlyBandwidthLimit,
              gracePeriodEndsAt: new Date(
                now.getTime() + newPlan.gracePeriod * 24 * 60 * 60 * 1000,
              ),
            });

            sub.status = "active";
            sub.limits = {
              quotaBytes: newPlan.quotaBytes,
              maxFileSize: newPlan.maxFileSize,
              chunkSize: newPlan.chunkSize,
              monthlyBandwidthLimit: newPlan.monthlyBandwidthLimit,
              maxUploadConcurrency: newPlan.maxUploadConcurrency,
              maxDevices: newPlan.maxDevices,
              canCreatePublicLinks: newPlan.canCreatePublicLinks,
              trashRetentionDays: newPlan.trashRetentionDays,
              gracePeriod: newPlan.gracePeriod,
            };
            await sub.save();

            await recalculateTrashExpiry(sub.user, newPlan.trashRetentionDays);
            await redisClient.del(`storageApp:user:${sub.user}:userdata`);

            if (userDoc && userDoc.email) {
              sendSubscriptionActionEmail(
                userDoc.name,
                userDoc.email,
                "downgrade",
                "executed",
                new Date().toLocaleDateString(),
              ).catch(console.error);
            }

            await createNotification({
              userId: sub.user,
              type: "system",
              title: "Plan downgraded",
              message: `Your plan has been changed to ${sub.planKey}.`,
              link: "/billing",
            });
          }
          console.log(
            `Executed ${pendingDowngrades.length} downgrade requests.`,
          );
          break;

        case "cancel-executor":
          // console.log("Running Cancel Executor...");
          const expiredCancellations = await Subscription.find({
            status: "cancelation_requested",
            cancelAtPeriodEnd: true,
            endedAt: { $lte: now },
          }).lean();

          for (const sub of expiredCancellations) {
            const freePlan = PLAN_DETAILS["FREE"];
            const userDoc = await User.findByIdAndUpdate(sub.user, {
              plan: "FREE",
              maxQuota: freePlan.quotaBytes,
              maxBandwidthQuota: freePlan.monthlyBandwidthLimit,
              subscription: null,
              subscriptionExpiresAt: null,
              gracePeriodEndsAt: new Date(
                now.getTime() + freePlan.gracePeriod * 24 * 60 * 60 * 1000,
              ),
            });

            await Subscription.findByIdAndUpdate(sub._id, {
              status: "cancelled",
              cancelAtPeriodEnd: false,
            });

            await recalculateTrashExpiry(
              sub.user,
              PLAN_DETAILS["FREE"].trashRetentionDays,
            );
            await redisClient.del(`storageApp:user:${sub.user}:userdata`);

            if (userDoc && userDoc.email) {
              sendSubscriptionActionEmail(
                userDoc.name,
                userDoc.email,
                "cancel",
                "executed",
                new Date().toLocaleDateString(),
              ).catch(console.error);
            }

            await createNotification({
              userId: sub.user,
              type: "system",
              title: "Subscription cancelled",
              message:
                "Your subscription has ended. You are now on the FREE plan.",
              link: "/billing",
            });
          }
          console.log(`Executed ${expiredCancellations.length} cancellations.`);
          break;

        case "trash-collector":
          // console.log("Running Trash Collector...");
          const [expiredFiles, expiredDirs] = await Promise.all([
            UserFile.find({
              isDeleted: true,
              permanentDeleteAt: { $lte: now },
            }).lean(),
            Directory.find({
              isDeleted: true,
              permanentDeleteAt: { $lte: now },
            }).lean(),
          ]);

          if (expiredFiles.length === 0 && expiredDirs.length === 0) break;

          const tcDirectoryBulkOps = [];
          const tcFileBulkOps = [];
          const tcDirBulkOps = [];
          const tcS3KeysToDelete = [];
          const expiredFileIds = expiredFiles.map((f) => f._id);
          const tcUniqueKeys = new Set();

          for (const file of expiredFiles) {
            if (file.key) tcUniqueKeys.add(file.key);
            tcDirectoryBulkOps.push({
              updateMany: {
                filter: { _id: { $in: file.path } },
                update: { $inc: { size: -file.size } },
              },
            });
            tcFileBulkOps.push({ deleteOne: { filter: { _id: file._id } } });
          }

          for (const dir of expiredDirs) {
            tcDirBulkOps.push({ deleteOne: { filter: { _id: dir._id } } });
          }

          const tcKeysToCheck = Array.from(tcUniqueKeys);
          const tcOtherFilesWithKeys = await UserFile.find({
            key: { $in: tcKeysToCheck },
            _id: { $nin: expiredFileIds },
          })
            .select("key")
            .lean();

          const tcKeysWithOtherCopies = new Set(
            tcOtherFilesWithKeys.map((f) => f.key),
          );

          for (const key of tcKeysToCheck) {
            if (!tcKeysWithOtherCopies.has(key)) tcS3KeysToDelete.push(key);
          }

          if (tcS3KeysToDelete.length > 0)
            await deleteS3Objects(tcS3KeysToDelete);

          if (tcFileBulkOps.length > 0) {
            await Directory.bulkWrite(tcDirectoryBulkOps);
            await UserFile.bulkWrite(tcFileBulkOps);
          }
          if (tcDirBulkOps.length > 0) await Directory.bulkWrite(tcDirBulkOps);

          const deletedByUser = new Map();
          const trackDeleted = (item, kind) => {
            const key = item.userId.toString();
            const entry = deletedByUser.get(key) || {
              files: 0,
              dirs: 0,
              names: [],
            };
            entry[kind]++;
            if (entry.names.length < 3) entry.names.push(item.name);
            deletedByUser.set(key, entry);
          };
          for (const file of expiredFiles) trackDeleted(file, "files");
          for (const dir of expiredDirs) trackDeleted(dir, "dirs");

          await Promise.all(
            Array.from(deletedByUser.entries()).map(([userId, entry]) => {
              const parts = [];
              if (entry.files)
                parts.push(
                  `${entry.files} file${entry.files !== 1 ? "s" : ""}`,
                );
              if (entry.dirs)
                parts.push(
                  `${entry.dirs} folder${entry.dirs !== 1 ? "s" : ""}`,
                );
              const suffix = entry.names.length
                ? ` (e.g., ${entry.names.join(", ")})`
                : "";
              return createNotification({
                userId,
                type: "storage_warning",
                title: "Items permanently deleted",
                message: `${parts.join(" and ")} permanently deleted from your Bin${suffix}.`,
                link: "/bin",
              });
            }),
          );

          console.log(
            `🗑️ Permanently deleted ${expiredFiles.length} files, ${expiredDirs.length} directories.`,
          );
          break;

        case "quota-reaper":
          // console.log("Running Quota Reaper...");
          const usersOverQuota = await User.find({
            gracePeriodEndsAt: { $lte: now },
          }).populate("root", "size");

          for (const user of usersOverQuota) {
            let currentSize = user.root?.size || 0;
            if (currentSize <= user.maxQuota) {
              await User.findByIdAndUpdate(user._id, {
                $unset: { gracePeriodEndsAt: 1 },
              });
              continue;
            }

            const oldestFiles = await UserFile.find({
              userId: user._id,
              isDeleted: false,
            }).sort({ createdAt: 1 });

            const filesToReap = [];
            for (const file of oldestFiles) {
              if (currentSize <= user.maxQuota) break;
              filesToReap.push(file);
              currentSize -= file.size;
            }

            const reapIds = filesToReap.map((f) => f._id);
            const qrDirectoryBulkOps = [];
            const qrFileBulkOps = [];
            const qrS3KeysToDelete = [];
            const qrUniqueKeys = new Set();

            for (const file of filesToReap) {
              if (file.key) {
                qrUniqueKeys.add(file.key);
              }

              qrDirectoryBulkOps.push({
                updateMany: {
                  filter: { _id: { $in: file.path } },
                  update: { $inc: { size: -file.size } },
                },
              });

              qrFileBulkOps.push({
                deleteOne: { filter: { _id: file._id } },
              });
            }

            const qrKeysToCheck = Array.from(qrUniqueKeys);
            const qrOtherFilesWithKeys = await UserFile.find({
              key: { $in: qrKeysToCheck },
              _id: { $nin: reapIds },
            })
              .select("key")
              .lean();

            const qrKeysWithOtherCopies = new Set(
              qrOtherFilesWithKeys.map((f) => f.key),
            );

            for (const key of qrKeysToCheck) {
              if (!qrKeysWithOtherCopies.has(key)) {
                qrS3KeysToDelete.push(key);
              }
            }

            if (qrS3KeysToDelete.length > 0) {
              await deleteS3Objects(qrS3KeysToDelete);
            }

            if (qrDirectoryBulkOps.length > 0) {
              await Directory.bulkWrite(qrDirectoryBulkOps);
              await UserFile.bulkWrite(qrFileBulkOps);
            }

            await User.findByIdAndUpdate(user._id, {
              $unset: { gracePeriodEndsAt: 1 },
            });
            await redisClient.del(`storageApp:user:${user._id}:userdata`);

            await createNotification({
              userId: user._id,
              type: "storage_warning",
              title: "Files removed due to storage limit",
              message:
                "Some of your oldest files were deleted because you exceeded your storage limit.",
              link: "/settings",
            });
          }
          break;

        case "bandwidth-reset":
          // console.log("Running Bandwidth Reset...");
          // Per-user rolling 30-day window: due when the window expired, plus a
          // one-time backfill for legacy users who already used bandwidth but
          // never got a reset timestamp.
          const dueUsers = await User.find(
            {
              $or: [
                { bandwidthResetAt: null, usedBandwidthQuota: { $gt: 0 } },
                { bandwidthResetAt: { $lte: now } },
              ],
            },
            { _id: 1 },
          ).lean();
          await User.updateMany(
            {
              $or: [
                { bandwidthResetAt: null, usedBandwidthQuota: { $gt: 0 } },
                { bandwidthResetAt: { $lte: now } },
              ],
            },
            {
              $set: {
                usedBandwidthQuota: 0,
                bandwidthResetAt: getBandwidthResetAt(),
              },
            },
          );
          await Promise.all(
            dueUsers.map((u) =>
              redisClient.del(`storageApp:user:${u._id}:userdata`),
            ),
          );
          await Promise.all(
            dueUsers.map((u) =>
              createNotification({
                userId: u._id,
                type: "system",
                title: "Bandwidth quota reset",
                message:
                  "Your 30-day bandwidth quota has been reset. Enjoy fresh download bandwidth!",
                link: "/",
              }),
            ),
          );
          console.log(`Reset bandwidth quota for ${dueUsers.length} users.`);
          break;

        case "halted-subscription-reaper":
          // console.log("Running Halted Subscription Reaper...");
          // Fetch all halted subs; filter per-plan grace in JS since each
          // tier has a different gracePeriod (FREE=7d, PRO=14d, BUSINESS=30d).
          const haltedSubs = await Subscription.find({
            status: "halted",
          }).lean();

          const nowMs = Date.now();
          const dayMs = 24 * 60 * 60 * 1000;

          const subsToReap = haltedSubs.filter((sub) => {
            const graceDays = sub.limits?.gracePeriod || 7;
            return new Date(sub.updatedAt).getTime() <= nowMs - graceDays * dayMs;
          });

          for (const sub of subsToReap) {
            const freePlan = PLAN_DETAILS["FREE"];
            await User.findByIdAndUpdate(sub.user, {
              plan: "FREE",
              maxQuota: freePlan.quotaBytes,
              maxBandwidthQuota: freePlan.monthlyBandwidthLimit,
              subscription: null,
              subscriptionExpiresAt: null,
              gracePeriodEndsAt: new Date(nowMs + freePlan.gracePeriod * dayMs),
            });
            await Subscription.findByIdAndUpdate(sub._id, {
              status: "completed",
            });
            await redisClient.del(`storageApp:user:${sub.user}:userdata`);
          }
          console.log(`Reaped ${subsToReap.length} halted subscriptions.`);
          break;

        case "abandoned-cart-tracker":
          // console.log("Running Abandoned Cart Tracker...");
          // 30-minute threshold
          const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

          const abandonedSubs = await Subscription.find({
            status: "created",
            createdAt: { $lt: thirtyMinsAgo },
          }).populate("user", "email name");

          if (abandonedSubs.length === 0) break;

          const subIdsToUpdate = [];

          for (const sub of abandonedSubs) {
            // Generate a link back to your pricing/checkout page
            const checkoutUrl = `${process.env.CLIENT_URL}/pricing?resume=${sub.planKey}`;

            sendAbandonedCartEmail(
              sub.user.name,
              sub.user.email,
              checkoutUrl,
            ).catch((err) =>
              console.error(
                `Failed to send abandoned cart email to ${sub.user.email}:`,
                err,
              ),
            );

            subIdsToUpdate.push(sub._id);
          }

          // Update status to "abandoned" so they are never emailed again
          if (subIdsToUpdate.length > 0) {
            await Subscription.updateMany(
              { _id: { $in: subIdsToUpdate } },
              { $set: { status: "abandoned" } },
            );
          }

          console.log(`Processed ${subIdsToUpdate.length} abandoned carts.`);
          break;

        case "share-token-invalidator":
          // console.log("Running Token Invalidator...");
          const query = [
            {
              shareTokenExpiresAt: { $lt: now },
              shareToken: { $exists: true },
            },
            {
              $unset: {
                shareToken: 1,
                shareTokenExpiresAt: 1,
                publicRole: 1,
                shareLink: 1,
              },
            },
          ];
          const [dir, file] = await Promise.all([
            Directory.updateMany(...query),
            UserFile.updateMany(...query),
          ]);
          console.log(
            `shareTokens are invalidated for ${dir.modifiedCount} dirs & ${file.modifiedCount} files`,
          );

          break;

        case "active-users-sweeper": {
          // console.log("Running Active Users Sweeper...");
          const cutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
          await redisClient.zRemRangeByScore(
            "storageApp:active_users",
            0,
            `(${cutoff}`,
          );
          break;
        }
      }
    } catch (error) {
      console.log("Error occured executing jobs!!", error.message);
      return error;
    }
  },
  { connection: redisConnection },
);

  worker.on("failed", (job, err) =>
    console.error(`Job ${job.name} failed:`, err),
  );

  return worker;
};

let started = false;

// Trim finished jobs so BullMQ lists don't grow unbounded (Redis key buildup).
// Old completed/failed job records are dropped after 7 days, capped by count.
const JOB_OPTS = {
  removeOnComplete: { age: 7 * 24 * 3600, count: 100 },
  removeOnFail: { age: 7 * 24 * 3600, count: 200 },
};

export const startBullMQJobs = async () => {
  if (started) return;
  started = true;

  console.log("🚀 Initializing BullMQ Repeatable Jobs...");

  try {
    const repeatableJobs = await backgroundQueue.getJobSchedulers();
    for (const job of repeatableJobs) {
      await backgroundQueue.removeJobScheduler(job.key);
    }

    // 00:00 — Date-gated resets (bandwidth + downgrade + cancel + stale tokens)
    await backgroundQueue.add(
      "downgrade-executor",
      {},
      { ...JOB_OPTS, repeat: { pattern: "0 0 * * *" } }, // daily at midnight
    );
    await backgroundQueue.add(
      "cancel-executor",
      {},
      { ...JOB_OPTS, repeat: { pattern: "0 0 * * *" } }, // daily at midnight
    );
    await backgroundQueue.add(
      "share-token-invalidator",
      {},
      { ...JOB_OPTS, repeat: { pattern: "0 0 * * *" } }, // daily at midnight
    );
    await backgroundQueue.add(
      "bandwidth-reset",
      {},
      { ...JOB_OPTS, repeat: { pattern: "0 0 * * *" } }, // daily at midnight
    );
    // 01:00 — Trash collector (heavy, runs alone)
    await backgroundQueue.add(
      "trash-collector",
      {},
      { ...JOB_OPTS, repeat: { pattern: "0 1 * * *" } }, // daily at 1am
    );
    // 02:00 — Quota reaper (medium-heavy, after trash cleanup)
    await backgroundQueue.add(
      "quota-reaper",
      {},
      { ...JOB_OPTS, repeat: { pattern: "0 2 * * *" } }, // daily at 2am
    );
    // 03:00 — Active users sweep (light)
    await backgroundQueue.add(
      "active-users-sweeper",
      {},
      { ...JOB_OPTS, repeat: { pattern: "0 3 * * *" } }, // daily at 3am
    );
    // 04:00 — Halted subscription reaper (per-plan gracePeriod, not hardcoded)
    await backgroundQueue.add(
      "halted-subscription-reaper",
      {},
      { ...JOB_OPTS, repeat: { pattern: "0 4 * * *" } }, // daily at 4am
    );
    // Every 15 min — Abandoned cart (revenue-sensitive, frequent)
    await backgroundQueue.add(
      "abandoned-cart-tracker",
      {},
      { ...JOB_OPTS, repeat: { pattern: "*/15 * * * *" } }, // every 15 min
    );

    // Only start consuming AFTER schedulers are (re)registered
    startBullMQWorker();
  } catch (err) {
    console.error("Failed to initialize BullMQ repeatable jobs:", err);
    started = false;
  }
};

// Standalone entrypoint: `node jobs/queueJobs.js [scheduler|worker]`
// Run the worker on its own process to avoid duplicate execution when app.js is scaled across multiple instances.
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const mode = process.argv[2] || process.env.QUEUE_MODE || "worker";
  await connectMongoose();
  if (mode === "scheduler") {
    await startBullMQJobs();
  } else {
    startBullMQWorker();
  }
}
