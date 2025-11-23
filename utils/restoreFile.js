import { writeFile } from "fs/promises";

let { default: directoriesDb } = await import(
  "../DBs/directories.db.json",
  { with: { type: "json" } }
);
let { default: filesDb } = await import("../DBs/files.db.json", {
  with: { type: "json" },
});
let { default: bin } = await import("../DBs/bins.db.json", {
  with: { type: "json" },
});

let userContent, binContent;
const findItemById = (arr, id) => arr.find((a) => a.id === id);
const removeItemById = (arr, id) => arr.filter((a) => a.id !== id);
const changeDestination = (id) => {
  const idx = filesDb.findIndex((f) => f.id === id);
  filesDb[idx].destination = "./RootDirectory";
};

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

const pushHelper = async (isFile, parentDir, item) => {

  if (isFile) {
    const idx = parentDir.files.findIndex((p) => p.id === item.id);
    if (idx === -1) parentDir.files.push({ id: item.id, name: item.name });
  } else {
    const idx = parentDir.directories.findIndex((p) => p.id === item.id);
    if (idx === -1)
      parentDir.directories.push({ id: item.id, name: item.name });
  }

  await writeFile(
    "./DBs/directories.db.json",
    JSON.stringify(directoriesDb)
  );
}

const searchAndPushToParentDir = async (item, isFile, visited = new Set()) => {
  try {
    if (item.id === undefined || item.parentId === undefined)
      return new Error("Error: id can not be undefined");

    if (visited.has(item.parentId)) return;
    if (item.parentId === null) {
      const parentDir = userContent[0]
      await pushHelper(isFile,parentDir,item)
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
      } else {
        parentDummy.parentId = parentInBin.parentId;
        parentDummy.parentName = parentInBin.parentName;
      }

      userContent.push(parentDummy);
      await writeFile(
        "./DBs/directories.db.json",
        JSON.stringify(directoriesDb)
      );
      return await searchAndPushToParentDir(parentInBin, false, visited);
    } else {
      await pushHelper(isFile,parentInDb,item)
    }
    return;
  } catch (error) {
    return error;
  }
};

const restoreFile = async (userId, item) => {
  try {
    const dbIndex = directoriesDb.findIndex((item) => item.id === userId);
    userContent = directoriesDb[dbIndex].content;
    binContent = bin.find((item) => item.id === userId).content;

    if (!userContent || !binContent)
      return new Error("Error : userId not found");

    const visited = new Set();
    await searchAndPushToParentDir(item, true, visited);

    //filesDb changed
    changeDestination(item.id);

    //removed from bin
    binContent[0].files = removeItemById(binContent[0].files, item.id);
    const parentInBin = findItemById(binContent, item.parentId);
    if (parentInBin) removeItemById(parentInBin.files, item.id);

    await Promise.all([
      writeFile(
        "./DBs/directories.db.json",
        JSON.stringify(directoriesDb)
      ),
      writeFile("./DBs/bins.db.json", JSON.stringify(bin)),
      writeFile("./DBs/files.db.json", JSON.stringify(filesDb)),
    ]);

    return;
  } catch (error) {
    console.log(error);
    return error;
  }
};
const restoreDirectory = async (userId, itemId) => {
  try {
    const dbIndex = directoriesDb.findIndex((d) => d.id === userId);
    const binIndex = bin.findIndex((b) => b.id === userId);
    userContent = directoriesDb[dbIndex].content;
    binContent = bin[binIndex].content;

    if (!userContent || !binContent)
      return new Error("Error : userId not found");

    const dirInDb = findItemById(userContent, itemId);
    const dirInBin = findItemById(binContent, itemId);

    if (!dirInDb) {
      await searchAndPushToParentDir(dirInBin, false);
      userContent.push(dirInBin);

      for (const file of dirInBin.files) {
        changeDestination(file.id);
      }
    } else {
      for (const file of dirInBin.files) {
        dirInDb.files.push(file);
        changeDestination(file.id);
      }

      for (const directory of dirInBin.directories) {
        const idx = dirInDb.directories.findIndex((d) => d.id === directory.id);
        if (idx === -1) dirInDb.directories.push(directory);
      }
    }

    binContent = removeItemById(binContent, itemId);
    binContent[0].directories = removeItemById(
      binContent[0].directories,
      itemId
    );

    bin[binIndex].content = binContent;
    directoriesDb[dbIndex].content = userContent;

    await Promise.all([
      writeFile(
        "./DBs/directories.db.json",
        JSON.stringify(directoriesDb)
      ),
      writeFile("./DBs/bins.db.json", JSON.stringify(bin)),
      writeFile("./DBs/files.db.json", JSON.stringify(filesDb)),
    ]);

    for (const child of dirInBin.directories) {
      await restoreDirectory(userId, child.id);
    }
  } catch (error) {
    console.log(error);
    return error;
  }
};

export { restoreFile, restoreDirectory };
