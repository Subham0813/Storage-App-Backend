import express from "express";
import serveFavicon from "serve-favicon";
import cors from "cors";

import authRoutes from "./routes/authRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import homeRoutes from "./routes/homeRoutes.js";

import { validateToken } from "./middlewares/validate.js";
import { connectDb } from "./configs/db.js";

import { Db } from "mongodb";
import { appendFile } from "fs/promises";

import "./configs/connect.js";

try {
  const db = await connectDb();
  const app = express();
  const port = 4000;

  app.use(serveFavicon(import.meta.dirname + "/public/favicon.ico"));
  app.use(
    cors({
      origin: "http://localhost:5173",
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

  app.use("/", validateToken, homeRoutes);

  app.use("/files", validateToken, fileRoutes);

  app.use("/dirs", validateToken, directoryRoutes);

  // 404 handler
  app.use((req, res) => {
    return res.status(404).send();
  });

  app.use(async (err, req, res, next) => {
    // console.log(err);
    // console.error(
    //   err?.errInfo?.details?.schemaRulesNotSatisfied[0]
    //     .propertiesNotSatisfied[0].details
    // );
    // await appendFile("./error.log", JSON.stringify(err.errorResponse));
    const status = err.statusCode || 500;
    const message =
      err?.message?.split(",")[0]?.split(`${err.code}:`)[1]?.trim() ||
      "Internal server error. Please try again later.";

    return res.status(status).json({
      success: false,
      message,
    });
  });

  app.listen(port, () => {
    console.log("server started at port :", port);
  });
} catch (error) {
  console.log({ [error.name]: error.message });
  process.exit(1);
}
