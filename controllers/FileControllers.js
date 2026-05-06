import mongoose from "mongoose";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { UserFile } from "../models/user_file.model.js";
import { Directory } from "../models/directory.model.js";
import { getErrorObject } from "../utils/helper.js";
import { s3Client, deleteS3Objects } from "../configs/s3Client.js";

const S3_BUCKET = process.env.S3_BUCKET_NAME;

/**
 * path: /api/files/preview/:id
 * what it do: Generate a short-lived (5 min) pre-signed S3 URL for inline file preview.
 * requirements:
 *   - req.params: { id: string }
 *   - req.Item: file object populated by `checkAccess` middleware
 */
export const previewFileHandler = async (req, res, next) => {
  try {
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("name key mime")
      .lean();

    if (!file || !file.key) return next(getErrorObject("File not found.", 404));
    console.log(file.mime, file.key);

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: file.key,
      ResponseContentDisposition: `inline; filename="${encodeURIComponent(file.name)}"`,
      ResponseContentType: file.mime,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    return res.status(200).json({ success: true, data: { url } });
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
    const file = await UserFile.findOne({
      _id: req.params.id,
      isDeleted: false,
    })
      .select("name key mime")
      .lean();

    if (!file || !file.key) return next(getErrorObject("File not found.", 404));

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: file.key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(file.name)}"`,
      ResponseContentType: file.mime,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    return res.status(200).json({ success: true, data: { url } });
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
      if (currentUsedStorage + file.size > targetUser.maxQuota) {
        throw getErrorObject("Insufficient storage quota.", 400);
      }

      // 2. Create new virtual user file (Sharing the exact same S3 key!)
      const { key, webViewLink, mime, size } = file;
      const newFileObj = {
        userId: fileUserId,
        parentId: req.target._id,
        ancestors: req.target.ancestors,
        name: `Copy of ${file.name}`,
        key,
        webViewLink,
        mime,
        size,
      };

      [copy] = await UserFile.create([newFileObj], { session });

      // 3. Update Target Directory AND its Ancestors Size
      await Directory.updateMany(
        { _id: { $in: req.target.ancestors } },
        { $inc: { size: file.size } },
        { session },
      );
    });

    return res.status(201).json({
      success: true,
      data: {
        item: {
          _id: copy._id,
          parentId: copy.parentId,
          name: copy.name,
          mime: copy.mime,
          size: copy.size,
        },
      },
    });
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
  let s3KeyToDelete = [];

  try {
    await session.withTransaction(async () => {
      // 1. Delete the user's virtual file
      const file = await UserFile.findOneAndDelete({
        _id: req.params.id,
        userId: req.user._id,
      })
        .select("ancestors parentId key size")
        .session(session)
        .lean();

      if (!file)
        throw getErrorObject("File not found or already deleted.", 404);

      // 2. Update Parent Directory AND Ancestors Size (Decrement)
      const dirsToUpdate = [...(file.ancestors || []), file.parentId];
      await Directory.updateMany(
        { _id: { $in: dirsToUpdate } },
        { $inc: { size: -file.size } },
        { session },
      );

      // 3. remaining copy count
      const remainingCopies = await UserFile.countDocuments({
        key: file.key,
      }).session(session);

      // 4. If no one else owns it, mark for physical deletion
      if (remainingCopies === 0) {
        s3KeyToDelete.push({ key: file.key });
      }

      // Trigger S3 deletion outside of DB transaction
      if (s3KeyToDelete.length > 0) {
        await deleteS3Objects(s3KeyToDelete);
      }
    });

    return res.status(200).json({
      success: true,
      message: "File permanently deleted.",
    });
  } catch (err) {
    next(err);
  } finally {
    await session.endSession();
  }
};
