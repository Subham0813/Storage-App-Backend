import { writeFile } from "fs/promises";

let { default: directoriesDb } = await import(
  "../models/directoriesDb.model.json",
  { with: { type: "json" } }
);
let { default: filesDb } = await import("../models/filesDb.model.json", {
  with: { type: "json" },
});
let { default: bin } = await import("../models/bin.model.json", {
  with: { type: "json" },
});

let userContent, binContent;

const findItemById = (arr, id) => arr.find((a) => a.id === id);
const removeItemById = (arr, id) => arr.filter((a) => a.id !== id);

const rmDirFromParentDir = (dir) => {
  if (!dir) return;
  
  const parentId = userContent.findIndex((item) => item.id === dir.parent_id);
  if(parentId === -1) return;

  userContent[parentId].directories = removeItemById(
    userContent[parentId].directories,
    dir.id
  );
  userContent = removeItemById(userContent, dir.id);
};

const recursiveDeletion = async (directory, deleted, visited = new Set()) => {
  try {
    if (!directory || visited.has(directory.id)) return;
    visited.add(directory.id);

    const directories = directory.directories || [];
    const files = directory.files || [];

    for (const file of files) {
      if (deleted) {
        await rm(
          `C:\\Subham_dir\\ProCodrr-NodeJS\\Storage-App-Express\\backend\\${file.path}`
        );
        filesDb = removeItemById(filesDb, file.id);
      } else {
        const fileInfo = findItemById(filesDb, file.id);
        fileInfo.destination = "./bin";
      }
    }
    await writeFile("./models/filesDb.model.json", JSON.stringify(filesDb));

    if (!deleted) {
      binContent.push(directory);
      await writeFile("./models/bin.model.json", JSON.stringify(bin));
    }

    for (const directory of directories) {
      const childDirectory = findItemById(userContent, directory.id);
      await recursiveDeletion(childDirectory, deleted, visited);
      rmDirFromParentDir(childDirectory);
    }
  } catch (error) {
    // console.log(error);
    return error;
  }
};

const deleteDirectory = async (userId, directory, deleted = false) => {
  try {
    const dbIndex = directoriesDb.findIndex((item) => item.id === userId);
    userContent = directoriesDb[dbIndex].content;
    binContent = bin.find((item) => item.id === userId).content;

    await recursiveDeletion(directory, deleted);
    rmDirFromParentDir(directory);

    directoriesDb[dbIndex].content = userContent;
    await writeFile(
      "./models/directoriesDb.model.json",
      JSON.stringify(directoriesDb)
    );
  } catch (error) {
    // console.log(error);
    return error;
  }
};

export default deleteDirectory;
