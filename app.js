import express from "express";
import serveFavicon from "serve-favicon";
import cors from "cors";
import { writeFile } from "fs/promises";

import fileRoutes from "./routes/fileRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { validateToken } from "./utils/createAndValidateToken.js";

let { default: bin } = await import("./DBs/bins.db.json", {
  with: { type: "json" },
});
let { default: directoriesDb } = await import("./DBs/directories.db.json", {
  with: { type: "json" },
});
let { default: filesDb } = await import("./DBs/files.db.json", {
  with: { type: "json" },
});
let { default: tokens } = await import("./DBs/tokens.db.json", {
  with: { type: "json" },
});
let { default: userDb } = await import("./DBs/users.db.json", {
  with: { type: "json" },
});

const app = express();
const port = 4000;

app.use(serveFavicon(import.meta.dirname + "/public/favicon.ico"));

app.use(cors());
app.use(express.json());

app.use("/auth", authRoutes);

//cookieParser
app.use((req, res, next) => {
  const cookies = {};
  if (!req.headers || !req.headers.cookie)
    return res.status(400).json("Cookies not found! Relogin with credentials.");

  req.headers.cookie.split("; ").forEach((item) => {
    const [key, val] = item.split("=");
    cookies[key] = val;
  });

  req.cookies = cookies;
  next();
});

app.use("/storage", validateToken("uid"), (req, res) => {
  res.status(200).json({
    res: true,
    message: "directory found!",
    content: directoriesDb.find((item) => item.id === req.user.id).content[0], //serving root directory
  });
});

app.use("/bin", validateToken("uid"), (req, res) => {
  res.status(200).json({
    res: true,
    message: "bin found!",
    content: bin.find((item) => item.id === req.user.id).content[0], //serving bin directory
  });
});

app.use("/files", validateToken("uid"), fileRoutes);

app.use("/dirs", validateToken("uid"), directoryRoutes);

app.delete("/delete", validateToken("uid"), async (req, res) => {
  userDb = userDb.filter((item) => item.id !== req.user.id);
  directoriesDb = directoriesDb.filter((item) => item.id !== req.user.id);
  bin = bin.filter((item) => item.id !== req.user.id);
  filesDb = filesDb.filter((item) => item.user_id !== req.user.id);
  tokens = tokens.filter((item) => item.userId !== req.user.id);

  await Promise.all([
    writeFile("./DBs/directories.db.json", JSON.stringify(directoriesDb)),
    writeFile("./DBs/users.db.json", JSON.stringify(userDb)),
    writeFile("./DBs/files.db.json", JSON.stringify(filesDb)),
    writeFile("./DBs/bins.db.json", JSON.stringify(bin)),
    writeFile("./DBs/tokens.db.json", JSON.stringify(tokens)),
  ]);

  return res
    .setHeader(
      "Set-Cookie",
      `uid=; expires=${new Date(new Date() - 3600 * 1000).toUTCString()}`
    )
    .status(200)
    .json("Account deleted successfully.");
});

app.listen(port, () => {
  console.log("server started at port :", port);
});
