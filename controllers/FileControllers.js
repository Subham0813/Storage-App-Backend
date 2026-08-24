import crypto from "crypto";
import mongoose from "mongoose";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { getErrorObject, getFileDoc, getUserLimits } from "../utils/helper.js";
import {
  s3Client,
  deleteS3Objects,
  BUCKET_NAME,
} from "../services/s3Client.js";
import { redisClient } from "../configs/redis.js";
import { IS_SAAS_MODE } from "../misc/constants.js";
import { User } from "../models/user.model.js";
import { UserFile as File } from "../models/user_file.model.js";
import { Permission } from "../models/permission.model.js";
import { generateSecureDownloadUrl } from "../services/cdnRouter.js";
import { logActivity } from "../utils/activityLogger.js";
import { ensureBandwidthWindow } from "../utils/bandwidthWindow.js";

// The Cloudflare worker/webhook bandwidth path is SaaS-only. In self-hosted
// mode the server always tracks bandwidth server-side (fallback), even if
// CDN_PROVIDER=cloudflare is configured.
const isCloudflare = IS_SAAS_MODE && process.env.CDN_PROVIDER === "cloudflare";

/**
 * path: /api/files/preview/:id
 * what it do: Generate a short-lived (5 min) pre-signed S3 URL for inline file preview.
 * requirements:
 *   - req.params: { id: string }
 *   - req.Item: file object populated by `checkAccess` middleware
 */
export const previewFileHandler = async (req, res, next) => {
  try {
    let owner = req.itemOwner || req.user;
    const limits = getUserLimits(owner);

    owner = await ensureBandwidthWindow(owner);

    const usedBandwidth = owner.usedBandwidthQuota || 0;
    const bandwidthLimit = limits?.monthlyBandwidth;

    if (usedBandwidth >= bandwidthLimit) {
      return next(
        getErrorObject(
          "Bandwidth limit exceeded. Please upgrade your plan.",
          403,
        ),
      );
    }

    let file =
      req.Item ||
      (await UserFile.findOne({ _id: req.params.id, isDeleted: false })
        .select("name key size mime webviewLink userId")
        .lean());

    if (!file || (!file.key && !file.webviewLink))
      return next(getErrorObject("File not found.", 404));

    // Handle Google Drive linked files
    if (file.webviewLink)
      return res
        .status(200)
        .json({ success: true, data: { url: file.webviewLink } });

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: file.key,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.name)}"`,
      ResponseContentType: file.mime,
    });

    const secureUrl = await generateSecureDownloadUrl(
      s3Client,
      command,
      file,
      owner._id,
      "preview",
    );

    // Hybrid Tracking
    await File.findByIdAndUpdate(file._id, {
      $inc: { accessCount: 1 },
      $set: { lastAccessedAt: new Date() },
    });

    if (!isCloudflare) {
      await User.findByIdAndUpdate(owner._id, {
        $inc: { usedBandwidthQuota: file.size || 0 },
      });

      redisClient
        .del(`storageApp:user:${owner._id.toString()}:userdata`)
        .catch(console.error);
    }

    return res.status(200).json({ success: true, data: { url: secureUrl } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/download/:id
 * what it do: Generate a short-lived (5 min) pre-signed S3 URL for file download (Content-Disposition: attachment).
 * requirements:
 *   - req.params: { id: string }
 *   - req.Item: file object populated by `checkAccess` middleware
 */
export const downloadFileHandler = async (req, res, next) => {
  try {
    let owner = req.itemOwner || req.user;

    owner = await ensureBandwidthWindow(owner);

    const limits = getUserLimits(owner);
    const usedBandwidth = owner.usedBandwidthQuota || 0;
    const bandwidthLimit = limits.monthlyBandwidth;

    // 1. Hard Quota Check
    if (usedBandwidth >= bandwidthLimit) {
      return next(
        getErrorObject(
          "Bandwidth limit exceeded. Please upgrade your plan.",
          403,
        ),
      );
    }

    let file =
      req.Item ||
      (await UserFile.findOne({ _id: req.params.id, isDeleted: false })
        .select("name key size userId")
        .lean());
    if (!file || !file.key) return next(getErrorObject("File not found.", 404));

    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: file.key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(file.name)}"`,
      ResponseContentType: file.mime,
    });

    const secureUrl = await generateSecureDownloadUrl(
      s3Client,
      command,
      file,
      owner._id,
      "download",
    );

    // Hybrid Tracking
    await File.findByIdAndUpdate(file._id, {
      $inc: { accessCount: 1 },
      $set: { lastAccessedAt: new Date() },
    });

    if (!isCloudflare) {
      await User.findByIdAndUpdate(owner._id, {
        $inc: { usedBandwidthQuota: file.size || 0 },
      });

      redisClient
        .del(`storageApp:user:${owner._id.toString()}:userdata`)
        .catch(console.error);
    }

    return res.status(200).json({ success: true, data: { url: secureUrl } });
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/files/copy/:id
 * what it do: Create a virtual copy of a file in the target directory (shares the same S3 key, no duplicate storage).
 * requirements:
 *   - req.params: { id: string } (source file ObjectId)
 *   - req.target: destination directory populated by `loadParentDir` middleware
 *   - req.user: authenticated user object
 */
export const copyFileHandler = async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .session(session)
      .lean();

    if (!file) return next(getErrorObject("Original file not found.", 404));

    const targetUser = req.target.userId;
    let fileUserId = file.userId;

    if (file.userId.toString() !== req.user._id.toString()) {
      fileUserId = targetUser._id;
    }

    let copy;
    await session.withTransaction(async () => {
      // 1. Quota Validation
      const currentUsedStorage = targetUser.root?.size || 0;
      const copyLimits = getUserLimits(targetUser);
      if (copyLimits.maxStorage !== Infinity && currentUsedStorage + file.size > copyLimits.maxStorage) {
        throw getErrorObject("Insufficient storage quota.", 400);
      }

      // 2. Create new virtual user file (Sharing the exact same S3 key!)
      const { key, webviewLink, extension, mime, size, thumbnailKey } = file;
      const newFileObj = {
        userId: fileUserId,
        parentId: req.target._id,
        path: req.target.path,
        name: `Copy of ${file.name}`,
        key,
        webviewLink,
        mime,
        size,
        extension,
        thumbnailKey,
        lastModifiedBy: targetUser._id,
      };

      [copy] = await UserFile.create([newFileObj], { session });

      const targetAncestors = [...req.target.path, req.target._id];
      // 3. Update Target Directory AND its Ancestors Size
      await Directory.updateMany(
        { _id: { $in: targetAncestors } },
        { $inc: { size: file.size }, lastModifiedBy: targetUser._id },
        { session },
      );
    });

    const fileUserKey = `storageApp:user:${fileUserId}:userdata`;
    const targetUserKey = `storageApp:user:${targetUser._id}:userdata`;
    await Promise.all([
      redisClient.del(fileUserKey),
      redisClient.del(targetUserKey),
    ]);

    const copyWithUser = await UserFile.findById(copy._id)
      .populate("userId", "_id name email avatarUrl")
      .lean();

    logActivity({
      userId: req.user._id,
      action: "copy",
      itemType: "file",
      itemId: copy._id,
      parentId: copy.parentId || undefined,
      itemName: file.name,
    });

    return res
      .status(201)
      .json({ success: true, data: { item: getFileDoc(copyWithUser) } });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
};

/**
 * path: /api/files/delete/:id
 * what it do: Permanently delete a file record. If no other user holds a copy of the same S3 key, also deletes the S3 object.
 * requirements:
 *   - req.params: { id: string }
 *   - req.user: authenticated file owner
 */
export const deleteFileHandler = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id))
    return next(getErrorObject("Invalid id."));

  const session = await mongoose.startSession();
  let key, thumbnailKey, fileName, fileParentId;

  try {
    [key, thumbnailKey] = await session.withTransaction(async () => {
      const file = await UserFile.findOneAndDelete(
        {
          _id: req.params.id,
          userId: req.user._id,
        },
        { session },
      )
        .select("name path parentId key thumbnailKey size")
        .lean();

      if (!file)
        throw getErrorObject("File not found or already deleted.", 404);

      fileName = file.name;
      fileParentId = file.parentId;

      await Permission.deleteMany({ itemId: file._id }).session(session);
      const dirsToUpdate = [...(file.path || []), file.parentId];

      await Directory.updateMany(
        { _id: { $in: dirsToUpdate } },
        { $inc: { size: -file.size }, lastModifiedBy: req.user._id },
        { session },
      );

      const count = await UserFile.countDocuments({
        key: file.key,
      }).session(session);

      await redisClient.del(`storageApp:user:${req.user._id}:userdata`);
      return count === 0 && file.key ? [file.key, file.thumbnailKey] : [];
    });

    // S3 deletion AFTER transaction
    if (key && thumbnailKey) {
      try {
        await Promise.all([
          deleteS3Objects([key]),
          deleteS3Objects([thumbnailKey], true),
        ]);
      } catch (s3Err) {
        console.error("S3 Deletion failed:", s3Err);
        throw s3Err;
      }
    }

    logActivity({
      userId: req.user._id,
      action: "delete",
      itemType: "file",
      itemId: req.params.id,
      parentId: fileParentId || undefined,
      itemName: fileName,
    });

    return res.status(200).json({
      success: true,
      message: "File permanently deleted and no longer available.",
      data: { id: req.params.id },
    });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
};