import { writeFile } from "fs/promises";

let { default: directoriesDb } = await import(
  "../models/directoriesDb.model.json",
  {
    with: { type: "json" },
  }
);
let { default: filesDb } = await import("../models/filesDb.model.json", {
  with: { type: "json" },
});

const handleGetDirectories = async (req, res) => {
  const { id } = req.params;
  const directory = directoriesDb
    .find((item) => item.id === req.user.id)
    .content.find((item) => item.id === id);

  try {
    if (!directory) throw new Error();
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
  const { id } = req.params;
  const file = filesDb.find((file) => file.user_id === req.user.id);

  try {
    if (!file) throw new Error();
    // res.status(200).json({ res: true, message: "file found.", content: file });
    res.sendFile(
      `C:\\Subham_dir\\ProCodrr-NodeJS\\Storage-App-Express\\backend\\${file.path}`,
      (error) => {
        // console.log(error)
      }
    );
  } catch (error) {
    console.log(error);
    res
      .status(404)
      .json({ res: false, message: "file not found!", content: null });
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
    await writeFile("./models/filesDb.model.json", JSON.stringify(filesDb));
    await writeFile(
      "./models/directoriesDb.model.json",
      JSON.stringify(directoriesDb)
    );
    res.status(201).json({ message: "file/s created." });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ message: "Internal server issue.", error });
  }
};

const handleCreateDirectory = async (req, res) => {
  const { dirId } = req.params;
  // console.log(req.headers, req.body, req.user);

  const userData = directoriesDb.find((item) => item.id === req.user.id);
  const userContent = userData.content;

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
  const { oldname, newname } = req.body;

  if (!oldname || !newname)
    return res.status(400).json({
      message: "bad request! oldname & newname should pass on with body.",
    });

  const fileInfo = filesDb.find((file) => file.id === req.params.id);
  if (!fileInfo)
    return res.status(400).json({
      message:
        "file with same name not found on Db! Request with a valid name.",
    });
  fileInfo.originalname = newname;

  const { parent_id } = fileInfo;

  const root = directoriesDb.find((item) => item.id === req.user.id);
  const destination = parent_id
    ? root.content.find((item) => item.id === parent_id).files
    : root.content[0].files;
  const rootfileInfo = destination.find((item) => item.id === fileInfo.id);

  rootfileInfo.filename = newname;

  try {
    await writeFile("./models/filesDb.model.json", JSON.stringify(filesDb));
    await writeFile(
      "./models/directoriesDb.model.json",
      JSON.stringify(directoriesDb)
    );
    res.status(201).json({ message: "File renamed successfully." });
  } catch (error) {
    res.status(500).json({ message: "Internal server issue." });
  }
};

const handleUpdateDirectory = async (req, res) => {
  const { oldname, newname } = req.body;

  if (!oldname || !newname)
    return res.status(400).json({
      message: "bad request! oldname & newname should pass on with body.",
    });
    

  const userContent = directoriesDb.find(
    (item) => item.id === req.user.id
  ).content;

  const directory = userContent.find((item) => item.id === req.params.id);

  if (!directory)
    return res.status(400).json({
      message:
        "directory with same name not found on Db! Request with a valid name.",
    });

  directory.name = newname;

  const rootIndex = userContent.findIndex(
    (item) => item.id === directory.parent_id
  );

  const rootDirectory = userContent[rootIndex].directories.find(
    (item) => item.id === req.params.id
  );
  rootDirectory.name = newname;

  try {
    await writeFile("./models/directoriesDb.model.json",JSON.stringify(directoriesDb));
    res.status(200).json({message: "Folder renamed successfully."});
  } catch (error) {
    res.status(500).json({ message: "Internal server issue." });
  }
};

export {
  handleGetDirectories,
  handleGetFiles,
  handleCreateFile,
  handleCreateDirectory,
  handleUpdateFile,
  handleUpdateDirectory,
};
