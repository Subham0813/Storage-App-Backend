import express from "express";
import serveFavicon from "serve-favicon";
import cors from "cors";

import fileRoutes from "./routes/fileRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { validateToken } from "./middlewares/validateToken.js";
import { connectDb } from "./utils/db.js";
import { Db } from "mongodb";

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

  app.use("/storage", validateToken, async (req, res) => {
    const { _id: userId } = req.user;

    try {
      const directories = await db
        .collection("directories")
        .find(
          { userId, parentId: null, isDeleted: false },
          {
            projection: {
              _id: 1,
              name: 1,
            },
          }
        )
        .toArray();

      const files = await db
        .collection("files")
        .find(
          { userId, parentId: null, isDeleted: false },
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

      const root = {
        name: "root",
        directories,
        files,
      };

      res.status(200).json({
        message: "directory found!",
        data: root, //serving root directory
      });
    } catch (error) {
      res.status(500).json({
        message: "Something went wrong!",
        data: null,
      });
    }
  });

  app.use("/bin", validateToken, async (req, res) => {
    const { _id: userId } = req.user;
    try {
      const directories = await db
        .collection("directories")
        .find(
          { userId: userId, isDeleted: true, deletedBy: "user" },
          {
            projection: {
              _id: 1,
              name: 1,
            },
          }
        )
        .toArray();

      const files = await db
        .collection("files")
        .find(
          { userId: userId, isDeleted: true, deletedBy: "user" },
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

      const bin = {
        name: "bin",
        directories,
        files,
      };

      res.status(200).json({
        message: "bin found!",
        data: bin, //serving bin directory
      });
    } catch (error) {
      res.status(500).json({
        message: "Something went wrong!",
        data: null,
      });
    }
  });

  app.use("/files", validateToken, fileRoutes);

  app.use("/dirs", validateToken, directoryRoutes);

  app.delete("/deleteProfile", validateToken, async (req, res) => {
    const db = req.db;
    const userId = req.user._id;

    try {
      const op = await Promise.all([
        db.collection("directories").deleteMany({ userId: userId }),
        db.collection("users").deleteOne({ _id: userId }),
        db.collection("files").deleteMany({ userId: userId }),
        db.collection("tokens").deleteMany({ userId: userId }),
      ]);

      return res
        .setHeader(
          "Set-Cookie",
          `uid=; expires=${new Date(new Date() - 3600 * 1000).toUTCString()}`
        )
        .status(200)
        .json({ message: "Account deleted successfully.", data: op });
    } catch (error) {
      res.status(500).json({
        message: "Something went wrong!",
        data: null,
      });
    }
  });

  app.listen(port, () => {
    console.log("server started at port :", port);
  });
} catch (error) {
  console.log({ [error.name]: error.message });
  process.exit(1);
}
