import express from "express";
import serveFavicon from "serve-favicon";
import cors from "cors";

import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import oauthRoutes from "./routes/oauthRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import homeRoutes from "./routes/homeRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import importDriveRoutes from "./routes/importDriveRoutes.js";
import shareRoutes from "./routes/shareRoutes.js";

import { validateSession } from "./middlewares/validateSession.js";

import connectMongoose from "./configs/connect.js";
import cookieParser from "cookie-parser";
import { errorHandler } from "./middlewares/errorHandler.js";

try {
  await connectMongoose();

  const app = express();
  const port = process.env.PORT || 4000;

  app.use(serveFavicon(import.meta.dirname + "/public/favicon.ico"));
  app.use(cors({ origin: "http://localhost:5173", credentials: true }));

  app.use(cookieParser(process.env.COOKIE_SECRET));

  app.use("/api/auth", express.json(), authRoutes);
  app.use("/api/oauth", express.json(), oauthRoutes);
  app.use("/api/uploads", validateSession, uploadRoutes);

  app.use(express.json());
  app.use("/api/shared", shareRoutes);
  app.use("/api/import", validateSession, importDriveRoutes);
  app.use("/api/home", validateSession, homeRoutes);
  app.use("/api/files", validateSession, fileRoutes);
  app.use("/api/directories", validateSession, directoryRoutes);
  app.use("/api/admin", validateSession, adminRoutes);

  // 404 handler
  app.use((req, res) => {
    return res.status(404).json({
      success: false,
      statusCode: 404,
      message: "Route not found.",
      error: "NOTFOUND",
    });
  });

  app.use(errorHandler);

  app.listen(port, () => {
    console.log("server started at port :", port);
  });
} catch (err) {
  console.log({ [err.name]: err.message });
  process.exit(1);
}
