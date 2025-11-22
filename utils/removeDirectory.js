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

let dbIndex, userContent, binContent;

const findItemById = (arr, id) => arr.find((a) => a.id === id);
const removeItemById = (arr, id) => arr.filter((a) => a.id !== id);
const findIndexById = (arr, id) => arr.findIndex((a) => a.id === id);

const recursiveRemove = async (directory, visited = new Set()) => {
  try {
    if (!directory || visited.has(directory.id)) return;
    visited.add(directory.id);

    const directories = directory.directories || [];
    const files = directory.files || [];

    for (const file of files) {
      const fileInfo = findItemById(filesDb, file.id);
      fileInfo.destination = "./bin";
    }
    await writeFile("./models/filesDb.model.json", JSON.stringify(filesDb));

    const binIdx = findIndexById(binContent, directory.id);
    if (binIdx === -1) binContent.push(directory);
    else {
      binContent[binIdx].directories.push(...directory.directories);
      binContent[binIdx].files.push(...directory.files);
    }

    for (const directory of directories) {
      const childDirectory = findItemById(userContent, directory.id);
      await recursiveRemove(childDirectory, visited);
      userContent = removeItemById(userContent, childDirectory.id);
    }

    await writeFile("./models/bin.model.json", JSON.stringify(bin));
  } catch (error) {
    // console.log(error);
    return error;
  }
};

const removeDirectory = async (userId, dir) => {
  try {
    dbIndex = findIndexById(directoriesDb, userId);
    userContent = directoriesDb[dbIndex].content;
    binContent = bin.find((item) => item.id === userId).content;

    const { id, name, parentId, parentName } = dir;

    await recursiveRemove(dir);
    userContent = removeItemById(userContent, id);

    const parentIdx = findIndexById(userContent, parentId);
    if (parentIdx !== -1) {
      userContent[parentIdx].directories = userContent[
        parentIdx
      ].directories.filter((d) => id !== d.id);
    }

    directoriesDb[dbIndex].content = userContent;
    await writeFile(
      "./models/directoriesDb.model.json",
      JSON.stringify(directoriesDb)
    );

    binContent[0].directories.push({ id, name, parentId, parentName });
    await writeFile("./models/bin.model.json", JSON.stringify(bin));
  } catch (error) {
    // console.log(error);
    return error;
  }
};

const removeFile = async (userId, file) => {
  try {
    const binIdx = findIndexById(bin, userId);
    binContent = bin[binIdx].content[0];
    userContent = directoriesDb.find((item) => item.id === userId).content;

    const parentIdx = findIndexById(userContent, file.parentId);
    if (parentIdx !== -1)
      userContent[parentIdx].files = removeItemById(
        userContent[parentIdx].files,
        file.id
      );

    const fileIdx = findIndexById(filesDb, file.id);
    if (fileIdx !== -1) filesDb[fileIdx].destination = "./bin";

    binContent.files.push({
      id: file.id,
      name: file.originalname,
      parentId: file.parentId,
      parentName: userContent[parentIdx].name,
    });

    bin[binIdx].content[0] = binContent;

    await Promise.all([
      writeFile("./models/filesDb.model.json", JSON.stringify(filesDb)),
      writeFile("./models/bin.model.json", JSON.stringify(bin)),
      writeFile(
        "./models/directoriesDb.model.json",
        JSON.stringify(directoriesDb)
      ),
    ]);
  } catch (error) {
    return error;
  }
};

export { removeDirectory, removeFile };
