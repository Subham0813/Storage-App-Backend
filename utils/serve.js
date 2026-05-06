import fs from "node:fs";
import path from "path";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { UPLOAD_ROOT } from "../misc/constants.js";

const MAX_DEPTH = process.env.MAX_DEPTH || 5;

/**
 * Utility: sanitizeName
 * Prevent directory traversal attacks
 */
export const sanitizeName = (name) => {
  if (typeof name !== "string") return "unnamed";
  return name.replace(/^[\.\/]+/, "").replace(/[<>:"/\\|?*]+/g, "_");
};

/**
 * Utility: serveZip
 * Recursively traverse directory tree and add files to ZIP archive.
 * (Permission checks are bypassed here because the route middleware
 * already verified access to the root folder being downloaded).
 */
export const serveZip = async ({
  archive,
  dirId,
  zipPath,
  visited,
  depth = 0,
}) => {
  const dirIdStr = dirId.toString();

  // 1. Cycle Detection & Depth Guard
  if (visited.has(dirIdStr)) return;
  visited.add(dirIdStr);
  if (depth > MAX_DEPTH) return;

  // 2. Fetch and append files
  const files = await UserFile.find({ parentId: dirId, isDeleted: false })
    .populate("meta", "objectKey")
    .lean();

  for (const file of files) {
    if (!file.meta || !file.meta.objectKey) continue;

    const filePath = path.resolve(
      UPLOAD_ROOT,
      file.userId.toString(),
      file.meta.objectKey,
    );

    if (fs.existsSync(filePath)) {
      const safeName = sanitizeName(file.name);
      archive.file(filePath, { name: zipPath + safeName });
    }
  }

  // 3. Fetch and recurse through child directories
  const dirs = await Directory.find(
    { parentId: dirId, isDeleted: false },
    { name: 1 },
  ).lean();

  for (const dir of dirs) {
    const safeDirName = sanitizeName(dir.name);

    // Add empty dir entry to ZIP structure
    archive.append("", { name: zipPath + safeDirName + "/" });

    // Recurse with depth + 1
    await serveZip({
      archive,
      dirId: dir._id,
      zipPath: zipPath + safeDirName + "/",
      visited,
      depth: depth + 1,
    });
  }
};
