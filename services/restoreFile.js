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

const getDummyParent = (item, isFile) => {
  const dummy = {
    id: item.parentId,
    name: item.parentName,
    parentId: null,
    parentName: null,
    directories: isFile
      ? []
      : [
          {
            id: item.id,
            name: item.name,
            parent_id: item.parentId,
            parentName: item.parentName,
          },
        ],
    files: isFile
      ? [
          {
            id: item.id,
            name: item.name,
            parent_id: item.parentId,
            parentName: item.parentName,
          },
        ]
      : [],
  };
  return dummy;
};

const searchAndPushToParentDir = async (item, isFile, visited) => {
  try {
    if (item.id === undefined || item.parentId === undefined)
      return new Error("Error: id can not be undefined");

    if (visited.has(item.parentId)) return;
    if (item.parentId === null) {
      isFile
        ? userContent[0].files.push(item)
        : userContent[0].directories.push(item);
      await writeFile(
        "./models/directoriesDb.model.json",
        JSON.stringify(directoriesDb)
      );
      return;
    }

    visited.add(item.parentId);

    let parentInDb = findItemById(userContent, item.parentId);
    if (!parentInDb) {
      let parentInBin = findItemById(binContent, item.parentId);
      const parentDummy = getDummyParent(item, isFile);

      if (!parentInBin) {
        userContent[0].directories.push({
          id: parentDummy.id,
          name: parentDummy.name,
        });
      }else{
        parentDummy.parentId = parentInBin.parentId
        parentDummy.parentName = parentInBin.parentName
      }

      userContent.push(parentDummy);
      await writeFile(
        "./models/directoriesDb.model.json",
        JSON.stringify(directoriesDb)
      );
      return await searchAndPushToParentDir(parentInBin, false, visited);
    } else {
      isFile
        ? parentInDb.files.push({ id: item.id, name: item.name })
        : parentInDb.directories.push({ id: item.id, name: item.name });
      await writeFile(
        "./models/directoriesDb.model.json",
        JSON.stringify(directoriesDb)
      );
    }
    return;
  } catch (error) {
    return error;
  }
};

const restoreFile = async (userId, itemId, isFile = true) => {
  try {
    const dbIndex = directoriesDb.findIndex((item) => item.id === userId);
    userContent = directoriesDb[dbIndex].content;
    binContent = bin.find((item) => item.id === userId).content;

    if (!userContent || !binContent)
      return new Error("Error : userId not found");

    const item = isFile
      ? findItemById(binContent[0].files, itemId)
      : findItemById(binContent, itemId);

    if (!item) return new Error("Error: itemId not found");

    const visited = new Set();
    await searchAndPushToParentDir(item, isFile, visited);

    if (isFile) {
      //filesDb changed
      const idx = filesDb.findIndex((f) => f.id === item.id);
      filesDb[idx].destination = "./RootDirectory";

      //removed from bin
      binContent[0].files = removeItemById(binContent[0].files, item.id);
      const parentInBin = findItemById(binContent, item.parentId);
      if (parentInBin) removeItemById(parentInBin.files, item.id);
    } else {
      //removed from bin
      binContent = removeItemById(binContent, item.id);
      binContent[0].directories = removeItemById(
        binContent[0].directories,
        item.id
      );
    }

    await Promise.all([
      writeFile(
        "./models/directoriesDb.model.json",
        JSON.stringify(directoriesDb)
      ),
      writeFile("./models/bin.model.json", JSON.stringify(bin)),
      writeFile("./models/filesDb.model.json", JSON.stringify(filesDb)),
    ]);

    return;
  } catch (error) {
    console.log(error);
    return error;
  }
};

export { restoreFile };
