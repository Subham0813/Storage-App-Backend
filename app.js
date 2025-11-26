import express from "express";
import serveFavicon from "serve-favicon";
import cors from "cors";
import { writeFile } from "fs/promises";

import fileRoutes from "./routes/fileRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { validateToken } from "./utils/createAndValidateToken.js";
import { connectDb } from "./utils/db.js";
import { Db } from "mongodb";

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

try {
  const db = await connectDb();
  const app = express();
  const port = 4000;

  app.use(serveFavicon(import.meta.dirname + "/public/favicon.ico"));
  app.use(
    cors({
      origin: "http://localhost:4000",
      credentials: true,
    })
  );
  app.use(express.json());

  app.use(async (req, res, next) => {
    req.db = db;
    next();
  });

  //cookieParser
  app.use((req, res, next) => {
    const cookies = {};
    if (req.headers && req.headers.cookie) {
      req.headers.cookie.split("; ").forEach((item) => {
        const [key, val] = item.split("=");
        cookies[key] = val;
      });
    }

    req.cookies = cookies;
    next();
  });

  app.use("/auth", authRoutes);

  app.use("/storage", validateToken("uid"), async (req, res) => {
    const { _id: userId } = req.user;
    const root = await db
      .collection("directories")
      .findOne({ userId, name: "root", parentId: null });

    const directories = await db
      .collection("directories")
      .find(
        { userId, parentId: root._id ,isDeleted:false},
        {
          projection: {
            _id:1,
            name: 1,
          },
        }
      )
      .toArray();

    const files = await db
      .collection("files")
      .find(
        { userId, parentId: root._id ,isDeleted:false},
        {
          projection: {
            originalname: 1,
            size: 1,
            mimeType: 1,
            createdAt: 1,
            modifiedAt: 1,
            _id: 1,
          },
        }
      )
      .toArray();

    const data = {
      _id: root._id,
      name: root.name,
      directories,
      files,
    };

    res.status(200).json({
      message: "directory found!",
      data, //serving root directory
    });
  });

  app.use("/bin", validateToken("uid"), async (req, res) => {
    const { _id: userId } = req.user;

    const directories = await db
      .collection("directories")
      .find(
        { userId, parentId: bin._id },
        {
          projection: {
            name: 1,
          },
        }
      )
      .toArray();

    const files = await db
      .collection("files")
      .find(
        { userId, parentId: bin._id },
        {
          projection: {
            originalname: 1,
            size: 1,
            mimeType: 1,
            createdAt: 1,
            modifiedAt: 1,
            _id: 1,
          },
        }
      )
      .toArray();

    const data = {
      _id: bin._id,
      name: bin.name,
      directories,
      files,
    };

    res.status(200).json({
      message: "bin found!",
      data, //serving bin directory
    });
  });

  app.use("/files", validateToken("uid"), fileRoutes);

  app.use("/dirs", validateToken("uid"), directoryRoutes);

  app.delete("/deleteProfile", validateToken("uid"), async (req, res) => {
    const db = req.db;
    const userId = req.user._id;

    await Promise.all([
      db.collection("directories").deleteMany({ userId }),
      db.collection("users").deleteOne({ _id:userId }),
      db.collection("files").deleteMany({ userId }),
      // writeFile("./DBs/tokens.db.json", JSON.stringify(tokens)),
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
} catch (error) {
  console.log({ [error.name]: error.message });
  process.exit(1);
}
