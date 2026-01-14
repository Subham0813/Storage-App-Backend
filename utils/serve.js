import fs from "node:fs";
import path from "path";

import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

async function serveZip({
  archive,
  userId,
  dirId,
  zipPath,
  visited,
  UPLOAD_ROOT,
}) {
  const dirIdStr = dirId.toString();

  if (visited.has(dirIdStr)) return;
  visited.add(dirIdStr);

  //Fetch files in this dir
  const files = await UserFile.find({
    parentId: dirId,
    userId,
    isDeleted: false,
  })
    .populate({ path: "meta", select: "objectKey" })
    .lean();

  for (const file of files) {
    const safeName = sanitizeName(file.name);
    const entryPath = zipPath + safeName;

    const absolutePath = path.resolve(UPLOAD_ROOT, file.meta.objectKey);
    // console.log({safeName, entryPath, absolutePath})

    // Safety check
    if (!absolutePath.startsWith(UPLOAD_ROOT)) continue;
    if (!fs.existsSync(absolutePath)) continue;

    archive.file(absolutePath, {
      name: entryPath,
    });
  }

  // Fetch child dirs
  const dirs = await Directory.find(
    {
      parentId: dirId,
      userId,
      isDeleted: false,
    },
    { name: 1 }
  ).lean();

  for (const dir of dirs) {
    const safeDirName = sanitizeName(dir.name);

    // Add empty dir entry (important)
    archive.append("", {
      name: zipPath + safeDirName + "/",
    });

    await serveZip({
      archive,
      userId,
      dirId: dir._id,
      zipPath: zipPath + safeDirName + "/",
      visited,
      UPLOAD_ROOT,
    });
  }
}

const sanitizeName = (name) => {
  return name
    .replace(/[\/\\]/g, "_") // no slashes
    .replace(/\.\./g, "_") // no traversal
    .trim();
};

export { serveZip, sanitizeName };
