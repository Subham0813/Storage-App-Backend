import archiver from "archiver";
import { Transform } from "stream";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import mongoose from "mongoose";

import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { Permission } from "../models/permission.model.js";
import { s3Client, BUCKET_NAME } from "../services/s3Client.js";
import { redisClient } from "../configs/redis.js";
import { User } from "../models/user.model.js";
import { getErrorObject, getUserLimits } from "../utils/helper.js";
import { serveZipS3, sanitizeName } from "../utils/serve.js";
import { ensureBandwidthWindow } from "../utils/bandwidthWindow.js";

/**
 * path: /api/files/bulk-download
 * what it do: Stream a ZIP archive containing multiple files and directories.
 *   - Each selected file becomes a root-level entry in the ZIP.
 *   - Each selected directory is archived via serveZipS3 (preserves hierarchy).
 *   - Bandwidth is tracked via usedBandwidthQuota.
 * requirements:
 *   - req.body: { items: [{ type: "file"|"directory", id: "ObjectId" }] }
 *   - req.user: authenticated user with view access to each item
 */
export const bulkDownloadHandler = async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return next(getErrorObject("No items provided.", 400));
    }

    // 1. Bandwidth check
    const limits = getUserLimits(req.user);

    await ensureBandwidthWindow(req.user);

    const usedBandwidth = req.user.usedBandwidthQuota || 0;
    const bandwidthLimit = limits?.monthlyBandwidth;
    if (usedBandwidth >= bandwidthLimit) {
      return next(
        getErrorObject(
          "Bandwidth limit exceeded. Please upgrade your plan.",
          403,
        ),
      );
    }

    const userId = req.user._id.toString();

    // 2. Validate items and check access
    const validItems = [];
    for (const item of items) {
      if (!mongoose.isValidObjectId(item.id)) {
        return next(getErrorObject(`Invalid id: ${item.id}`, 400));
      }

      if (item.type === "file") {
        const file = await UserFile.findOne({
          _id: item.id,
          isDeleted: false,
        })
          .select("name key size userId mime path")
          .lean();
        if (!file)
          return next(getErrorObject(`File not found: ${item.id}`, 404));

        const isOwner = file.userId.toString() === userId;
        const ancestors = [...(file.path || []), file._id];
        const hasPermission = await Permission.exists({
          userId: req.user._id,
          itemId: { $in: ancestors },
          permission: { $in: ["view", "edit"] },
        });
        if (!isOwner && !hasPermission) {
          return next(
            getErrorObject(`Unauthorized access to file: ${item.id}`, 403),
          );
        }

        if (file.key) validItems.push({ type: "file", data: file });
      } else if (item.type === "directory") {
        const dir = await Directory.findOne({
          _id: item.id,
          isDeleted: false,
        })
          .select("name userId path")
          .lean();
        if (!dir)
          return next(getErrorObject(`Directory not found: ${item.id}`, 404));

        const isOwner = dir.userId.toString() === userId;
        const ancestors = [...(dir.path || []), dir._id];
        const hasPermission = await Permission.exists({
          userId: req.user._id,
          itemId: { $in: ancestors },
          permission: { $in: ["view", "edit"] },
        });
        if (!isOwner && !hasPermission) {
          return next(
            getErrorObject(
              `Unauthorized access to directory: ${item.id}`,
              403,
            ),
          );
        }

        validItems.push({ type: "directory", data: dir });
      } else {
        return next(getErrorObject(`Invalid type: ${item.type}`, 400));
      }
    }

    if (validItems.length === 0) {
      return next(getErrorObject("No downloadable items found.", 400));
    }

    // 3. Stream ZIP
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:.]/g, "")
      .slice(0, 15);
    const zipName = `download-${timestamp}.zip`;

    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "X-Content-Type-Options": "nosniff",
    });

    const archive = archiver("zip", { zlib: { level: 2 } });

    let totalBytes = 0;
    const byteCounter = new Transform({
      transform(chunk, encoding, callback) {
        totalBytes += chunk.length;
        callback(null, chunk);
      },
    });

    archive.on("error", (err) => {
      archive.abort();
      next(err);
    });

    archive.pipe(byteCounter).pipe(res);

    const errors = [];
    for (const item of validItems) {
      if (item.type === "file") {
        try {
          const { Body } = await s3Client.send(
            new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: item.data.key,
            }),
          );
          archive.append(Body, { name: sanitizeName(item.data.name) });
        } catch (err) {
          console.error(`Failed to stream file ${item.data.name}:`, err);
          errors.push(item.data.name);
        }
      } else {
        const dirName = sanitizeName(item.data.name);
        archive.append("", { name: dirName + "/" });
        try {
          await serveZipS3({
            archive,
            dirId: item.data._id,
            zipPath: dirName + "/",
          });
        } catch (err) {
          console.error(`Failed to archive directory ${item.data.name}:`, err);
          errors.push(item.data.name);
        }
      }
    }

    await archive.finalize();
    byteCounter.end();

    // 4. Track bandwidth
    if (totalBytes > 0) {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { usedBandwidthQuota: totalBytes },
      });
      redisClient
        .del(`storageApp:user:${userId}:userdata`)
        .catch(console.error);
    }

    console.info(
      `Bulk download: ${validItems.length} items, ${totalBytes} bytes, errors: ${errors.length}`,
    );
  } catch (err) {
    if (res.headersSent) {
      console.error("Bulk download stream failed:", err.message);
      res.end();
    } else {
      next(err);
    }
  }
};
