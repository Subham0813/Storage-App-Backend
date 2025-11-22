import express from "express";
import serveFavicon from "serve-favicon";
import cors from "cors";
import { writeFile } from "fs/promises";

import fileRoutes from "./routes/fileRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { validateToken } from "./services/createAndValidateToken.js";

let { default: userDb } = await import("./models/userDb.model.json", {
  with: { type: "json" },
});
let { default: tokens } = await import("./models/tokens.model.json", {
  with: { type: "json" },
});
let { default: bin } = await import("./models/bin.model.json", {
  with: { type: "json" },
});
let { default: filesDb } = await import("./models/filesDb.model.json", {
  with: { type: "json" },
});
let { default: directoriesDb } = await import(
  "./models/directoriesDb.model.json",
  {
    with: { type: "json" },
  }
);

const app = express();
const port = 4000;

app.use(serveFavicon(import.meta.dirname + "/public/favicon.ico"));

app.use(cors());
app.use(express.json());

app.use("/", authRoutes);
app.use((req, res, next) => {
  //parsing cookies
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

app.delete("/", validateToken("uid"), async (req, res) => {
  userDb = userDb.filter((item) => item.id !== req.user.id);
  directoriesDb = directoriesDb.filter((item) => item.id !== req.user.id);
  bin = bin.filter((item) => item.id !== req.user.id);
  filesDb = filesDb.filter((item) => item.user_id !== req.user.id);
  tokens = tokens.filter((item) => item.userId !== req.user.id);

  await Promise.all([
    writeFile("./models/userDb.model.json", JSON.stringify(userDb)),
    writeFile(
      "./models/directoriesDb.model.json",
      JSON.stringify(directoriesDb)
    ),
    writeFile("./models/filesDb.model.json", JSON.stringify(filesDb)),
    writeFile("./models/bin.model.json", JSON.stringify(bin)),
    writeFile("./models/tokens.model.json", JSON.stringify(tokens)),
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
