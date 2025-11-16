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
        filesDb = filesDb.filter((item) => item.id !== file.id);
      } else {
        const fileInfo = filesDb.find((item) => item.id === file.id);
        fileInfo.destination = "./bin";
      }
    }

    binContent.push(directory);

    await writeFile("./models/bin.model.json", JSON.stringify(bin));
    await writeFile("./models/filesDb.model.json", JSON.stringify(filesDb));

    for (const directory of directories) {
      const childDirectory = userContent.find(
        (item) => item.id === directory.id
      );

      await recursiveDeletion(childDirectory, deleted, visited);

      const parentId = userContent.findIndex(
        (item) => item.id === childDirectory.parent_id
      );
      const modifiedDirectories = userContent[parentId].directories.filter(
        (item) => item.id !== childDirectory.id
      );
      userContent[parentId].directories = modifiedDirectories;
      userContent = userContent.filter((item) => item.id !== childDirectory.id);
    }
  } catch (error) {
    // console.log(error);
    return error;
  }
};

const deletion = async (userId, directory, deleted = false) => {
  try {
    const dbIndex = directoriesDb.findIndex((item) => item.id === userId);
    userContent = directoriesDb[dbIndex].content;
    binContent = bin.find((item) => item.id === userId).content;

    await recursiveDeletion(directory, deleted);
    const parentId = userContent.findIndex(
      (item) => item.id === directory.parent_id
    );
    const modifiedDirectories = userContent[parentId].directories.filter(
      (item) => item.id !== directory.id
    );
    userContent[parentId].directories = modifiedDirectories;
    userContent = userContent.filter((item) => item.id !== directory.id);

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

export default deletion;
