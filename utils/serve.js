import fs from "node:fs";
import path from "path";

import Directory from "../models/directory.model.js";
import FileModel from "../models/file.model.js";

async function serve({
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
  const files = await FileModel.find({
    parentId: dirId,
    userId,
    isDeleted: false,
  }).lean();

  for (const file of files) {
    const safeName = sanitizeName(file.originalname);
    const entryPath = zipPath + safeName;

    const absolutePath = path.resolve(UPLOAD_ROOT, file.objectKey);
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

    await serve({

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

export default serve;
