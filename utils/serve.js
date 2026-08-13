import archiver from "archiver";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { s3Client } from "../services/s3Client.js";

// const S3_BUCKET = process.env.S3_BUCKET_NAME;
const S3_BUCKET = process.env.B2_BUCKET_NAME;
const MAX_DEPTH = process.env.MAX_DEPTH || 5;

export const sanitizeName = (name) => {
  if (typeof name !== "string") return "unnamed";
  return name.replace(/^[\.\/]+/, "").replace(/[<>:"/\\|?*]+/g, "_");
};

/**
 * Utility: serveZipS3
 * Recursively fetches file streams from S3 and appends them to the ZIP archive.
 */
export const serveZipS3 = async ({
  archive,
  dirId,
  zipPath = "",
  visited = new Set(),
  depth = 0,
}) => {
  const dirIdStr = dirId.toString();

  // 1. Cycle Detection & Depth Guard
  if (visited.has(dirIdStr)) return;
  visited.add(dirIdStr);
  if (depth > MAX_DEPTH) return;

  // 2. Fetch and append files from S3
  const files = await UserFile.find({
    parentId: dirId,
    isDeleted: false,
  }).lean();

  const fileStreams = await Promise.all(
    files
      .filter((f) => f.key)
      .map(async (file) => {
        try {
          const { Body } = await s3Client.send(
            new GetObjectCommand({ Bucket: S3_BUCKET, Key: file.key })
          );
          return { Body, name: sanitizeName(file.name) };
        } catch (err) {
          console.error(`Failed to stream file ${file.name} from S3:`, err);
          return null;
        }
      })
  );

  for (const stream of fileStreams) {
    if (stream) archive.append(stream.Body, { name: zipPath + stream.name });
  }

  // 3. Fetch and recurse through child directories
  const dirs = await Directory.find(
    { parentId: dirId, isDeleted: false },
    { dirname: 1, name: 1 },
  ).lean();

  for (const dir of dirs) {
    const folderName = dir.name || dir.dirname;
    const safeDirName = sanitizeName(folderName);

    // Add empty dir entry to ZIP structure
    archive.append("", { name: zipPath + safeDirName + "/" });

    // Recurse with depth + 1
    await serveZipS3({
      archive,
      dirId: dir._id,
      zipPath: zipPath + safeDirName + "/",
      visited,
      depth: depth + 1,
    });
  }
};
