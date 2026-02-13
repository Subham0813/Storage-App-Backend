import fs from "node:fs";
import path from "path";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

const MAX_DEPTH = process.env.MAX_DEPTH || 5;
const UPLOAD_ROOT =
  process.env.UPLOAD_ROOT || path.resolve(process.cwd() + "/uploads");

/**
 * Utility: serveZip
 * what it do: Recursively traverse directory tree, add files and folders to ZIP archive respecting depth and permissions.
 * requirements:
 *   - archive: archiver instance for ZIP creation
 *   - dirId: directory ObjectId to process
 *   - zipPath: current path in ZIP structure
 *   - visited: Set to prevent circular references
 *   - userEmail: email to check shared access permissions
 *   - depth: current recursion depth (defaults to 0, stops at MAX_DEPTH)
 */
export const serveZip = async ({
  archive,
  dirId,
  zipPath,
  visited,
  userEmail,
  depth = 0, // Current depth level
}) => {
  const dirIdStr = dirId.toString();

  // 1. Cycle Detection
  if (visited.has(dirIdStr)) return;
  visited.add(dirIdStr);

  // 2. Max Depth Guard
  // If we've hit the limit, stop processing this branch entirely
  if (depth > MAX_DEPTH) return;

  // --- A. Fetch files in this dir ---
  const files = await UserFile.find({
    parentId: dirId,
    isDeleted: false,
    $or: [
      { publicRole: { $in: ["VIEWER", "EDITOR"] } },
      {
        sharedWith: {
          $elemMatch: {
            email: userEmail,
            role: { $in: ["VIEWER", "EDITOR"] },
          },
        },
      },
    ],
  })
    .populate("meta", "objectKey")
    .lean();

  for (const file of files) {
    const safeName = sanitizeName(file.filename);
    const entryPath = zipPath + safeName;

    // Ensure meta exists before accessing objectKey
    if (!file.meta?.objectKey) continue;

    const absolutePath = path.resolve(UPLOAD_ROOT, file.meta.objectKey);

    if (!absolutePath.startsWith(UPLOAD_ROOT)) continue;
    if (!fs.existsSync(absolutePath)) continue;

    archive.file(absolutePath, { name: entryPath });
  }

  // If we are already at MAX_DEPTH, do not query for sub-directories.
  // This saves a database call and prevents adding empty folders that we won't populate.
  if (depth === MAX_DEPTH) return;

  // --- B. Fetch child dirs ---
  const dirs = await Directory.find(
    {
      parentId: dirId,
      isDeleted: false,
      $or: [
        { publicRole: "VIEWER" },
        {
          sharedWith: {
            $elemMatch: {
              email: userEmail,
              role: { $in: ["VIEWER", "EDITOR"] },
            },
          },
        },
      ],
    },
    { name: 1 }, // Only fetch name to save bandwidth
  ).lean();

  for (const dir of dirs) {
    const safeDirName = sanitizeName(dir.dirname);

    // Add empty dir entry to ZIP structure
    archive.append("", {
      name: zipPath + safeDirName + "/",
    });

    // Recurse with depth + 1
    await serveZip({
      archive,
      dirId: dir._id,
      zipPath: zipPath + safeDirName + "/",
      visited,
      userEmail,
      depth: depth + 1,
    });
  }
};

/**
 * Utility: sanitizeName
 * what it do: Sanitize file/directory names to prevent directory traversal attacks and invalid path characters.
 * requirements:
 *   - name: filename or directory name string
 *   - Removes '/', '\', '..', and trims whitespace
 *   - Returns: sanitized name (defaults to 'Untitled' if name is empty)
 */
export const sanitizeName = (name) => {
  if (!name) return "Untitled";
  return name
    .replace(/[\/\\]/g, "_")
    .replace(/\.\./g, "_")
    .trim();
};
