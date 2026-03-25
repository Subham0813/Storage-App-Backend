import express from "express";
import serveFavicon from "serve-favicon";
import cors from "cors";
import cookieParser from "cookie-parser";

import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import oauthRoutes from "./routes/oauthRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import homeRoutes from "./routes/homeRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import importDriveRoutes from "./routes/importDriveRoutes.js";
import shareRoutes from "./routes/shareRoutes.js";

import {
  validateSession,
  verifyCsrfOrigin,
} from "./middlewares/validateSession.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import connectMongoose from "./configs/connect.js";

try {
  await connectMongoose();

  const app = express();
  const port = process.env.PORT || 4000;

  app.use(serveFavicon(import.meta.dirname + "/public/favicon.ico"));
  app.use(
    cors({
      origin: [process.env.ALLOWED_ORIGINS],
      credentials: true,
    }),
  );

  app.use(cookieParser(process.env.COOKIE_SECRET));

  app.use("/api/auth", express.json(), authRoutes);
  app.use("/api/oauth", express.json(), oauthRoutes);
  app.use("/api/uploads", validateSession, uploadRoutes);

  app.use(express.json(), verifyCsrfOrigin, validateSession);
  app.use("/api/import", importDriveRoutes);
  app.use("/api/home", homeRoutes);
  app.use("/api/files", fileRoutes);
  app.use("/api/directories", directoryRoutes);
  app.use("/api/admin", adminRoutes);

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
