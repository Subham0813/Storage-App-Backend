import { rm, writeFile } from "fs/promises";
import deleteDirectory from "../services/deleteDirectoryRecursive.js";

let { default: directoriesDb } = await import(
  "../models/directoriesDb.model.json",
  {
    with: { type: "json" },
  }
);
let { default: filesDb } = await import("../models/filesDb.model.json", {
  with: { type: "json" },
});
let { default: bin } = await import("../models/bin.model.json", {
  with: { type: "json" },
});

const handleGetDirectories = async (req, res) => {
  const userContent = directoriesDb.find(
    (item) => item.id === req.user.id
  ).content;
  const directory = userContent.find((item) => item.id === req.params.id);

  try {
    if (!userContent || !directory) throw new Error();
    res
      .status(200)
      .json({ res: true, message: "directory found.", content: directory });
  } catch (error) {
    res
      .status(404)
      .json({ res: false, message: "directory not found!", content: null });
  }
};

const handleGetFiles = async (req, res) => {
  const file = filesDb.find(
    (file) =>
      file.user_id === req.user.id &&
      file.id === req.params.id &&
      file.destination === "./RootDirectory"
  );

  try {
    if (!file) throw new Error("file not found");

    res.sendFile(
      `C:\\Subham_dir\\ProCodrr-NodeJS\\Storage-App-Express\\backend\\${file.path}`,
      (error) => {
        // console.log(error)
      }
    );
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const handleCreateFile = async (req, res) => {
  const { dirId } = req.params;
  // console.log(req.user)
  const userContent = directoriesDb.find(
    (item) => item.id === req.user.id
  ).content;

  let parentDirectory = dirId
    ? userContent.find((item) => item.id === dirId)
    : userContent[0];

  if (!parentDirectory)
    return res.status(404).json({ message: "Directory Not Found!" });
  if (!req.file)
    return res.status(400).json({ message: "no file in the request!" });

  req.file.parent_id = parentDirectory.id;
  req.file.user_id = req.user.id;

  filesDb.push(req.file);

  parentDirectory.files.push({
    id: req.file.id,
    filename: req.file.originalname,
  });

  // console.log(filesDb);
  try {
    await Promise.all([
      writeFile("./models/filesDb.model.json", JSON.stringify(filesDb)),
      writeFile(
        "./models/directoriesDb.model.json",
        JSON.stringify(directoriesDb)
      ),
    ]);
    res.status(201).json({ message: "file/s created." });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ message: "Internal server issue.", error });
  }
};

const handleCreateDirectory = async (req, res) => {
  const { dirId } = req.params;
  // console.log(req.headers, req.body, req.user);

  const userContent = directoriesDb.find(
    (item) => item.id === req.user.id
  ).content;

  const parentDirectory = dirId
    ? userContent.find((item) => item.id === dirId)
    : userContent[0];

  if (!parentDirectory)
    return res.status(404).json({ message: "Directory Not Found!" });

  const newDirectory = {
    id: crypto.randomUUID(),
    name: req.body.name ? req.body.name : "Untitled Folder",
    parent_id: parentDirectory.id,
    directories: [],
    files: [],
  };

  parentDirectory.directories.push({
    id: newDirectory.id,
    name: newDirectory.name,
  });

  userContent.push(newDirectory);

  try {
    await writeFile(
      "./models/directoriesDb.model.json",
      JSON.stringify(directoriesDb)
    );
    res.status(201).json({ message: "Folder created." });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ message: "Internal server issue." });
  }
};

const handleUpdateFile = async (req, res) => {
  const { newname } = req.body;

  if (!newname)
    return res.status(400).json({
      message: "bad request! oldname & newname should pass on with body.",
    });

  //changing filename if exists in filesDb
  const file = filesDb.find((file) => file.id === req.params.id);
  if (!file)
    return res.status(404).json({
      message:
        "file with same name not found on Db! Request with a valid name.",
    });
  file.originalname = newname;

  //changing filename in its parent folder
  const userContent = directoriesDb.find(
    (item) => item.id === req.user.id
  ).content;
  const parentId = userContent.findIndex((item) => item.id === file.parent_id);
  const fileInDirectoryDb = userContent[parentId].files.find(
    (item) => item.id === file.id
  );

  fileInDirectoryDb.filename = newname;

  try {
    await Promise.all([
      writeFile("./models/filesDb.model.json", JSON.stringify(filesDb)),
      writeFile(
        "./models/directoriesDb.model.json",
        JSON.stringify(directoriesDb)
      ),
    ]);
    res.status(200).json({ message: "File renamed successfully." });
  } catch (error) {
    res.status(500).json({ message: "Internal server issue." });
  }
};

const handleUpdateDirectory = async (req, res) => {
  const { newname } = req.body;
  if (!newname)
    return res.status(400).json({
      message: "bad request! oldname & newname should pass on with body.",
    });

  const userContent = directoriesDb.find(
    (item) => item.id === req.user.id
  ).content;

  //changing name of the directory itself
  const directory = userContent.find((item) => item.id === req.params.id);
  if (!directory)
    return res.status(404).json({
      message:
        "directory with same name not found on Db! Request with a valid name.",
    });
  directory.name = newname;

  //changing name of the directory exists in the parent folder
  const parentId = userContent.findIndex(
    (item) => item.id === directory.parent_id
  );
  const directoryInDirectoryDb = userContent[parentId].directories.find(
    (item) => item.id === req.params.id
  );
  directoryInDirectoryDb.name = newname;

  try {
    await writeFile(
      "./models/directoriesDb.model.json",
      JSON.stringify(directoriesDb)
    );
    res.status(200).json({ message: "Folder renamed successfully." });
  } catch (error) {
    res.status(500).json({ message: "Internal server issue." });
  }
};

//permanent delete & move to bin  logic
const handleMoveToBinFile = async (req, res) => {

  const binContent = bin.find((item) => item.id === req.user.id).content[0];
  const userContent = directoriesDb.find(
    (item) => item.id === req.user.id
  ).content;
  const file = filesDb.find(
    (item) => item.user_id === req.user.id && item.id === req.params.id 
  );
  
  if (!file)
    return res
      .status(404)
      .json({ message: "file not found !! try with a valid id." });

  //removing file from directoriesDb
  const parentDirIdx = userContent.findIndex(
    (item) => item.id === file.parent_id
  );
  userContent[parentDirIdx].files = userContent[parentDirIdx].files.filter(
    (item) => item.id !== file.id
  );

  // if (!deleted) {
    //changing file destinaton in filesDb
    file.destination = "./bin";
    binContent.files.push({
      id: file.id,
      name: file.originalname,
      parentId: file.parent_id,
      parentDirName: userContent[parentDirIdx].name,
    });
  // } else {
  //   filesDb = filesDb.filter((item) => item.id !== file.id);
  //   binContent.files = binContent.files.filter((item) => item.id !== file.id);
  // }

  try {
    await writeFile("./models/filesDb.model.json", JSON.stringify(filesDb));
    await writeFile("./models/bin.model.json", JSON.stringify(bin));
    await writeFile(
      "./models/directoriesDb.model.json",
      JSON.stringify(directoriesDb)
    );

    // if (deleted) {
    //   await rm(
    //     `C:\\Subham_dir\\ProCodrr-NodeJS\\Storage-App-Express\\backend\\${file.path}`
    //   );
    //   return res.status(200).json({ message: "File deleted permanently." });
    // }
    return res.status(200).json({ message: "File moved to bin." });
  } catch (error) {
    return res.status(500).json({ message: "Internal server issue." });
  }
};

const handleMoveToBinDirectory = async (req, res) => {
  const userContent = directoriesDb.find(
    (item) => item.id === req.user.id
  ).content;

  const directory = userContent.find((item) => item.id === req.params.id);
  if (!directory)
    return res
      .status(404)
      .json({ message: "Folder not found !! try with a valid id." });
  try {
    await deleteDirectory(req.user.id, directory);
    return res.status(200).json({ message: "Folder moved to bin." });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server issue." });
  }
};

export {
  handleGetDirectories,
  handleGetFiles,
  handleCreateFile,
  handleCreateDirectory,
  handleUpdateFile,
  handleUpdateDirectory,
  handleMoveToBinFile,
  handleMoveToBinDirectory,
};
