import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import oauthRoutes from "./routes/oauthRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import homeRoutes from "./routes/userRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import importDriveRoutes from "./routes/importDriveRoutes.js";

import {
  validateSession,
  verifyCsrfOrigin,
} from "./middlewares/validateSession.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import connectMongoose from "./configs/connect.js";
import { getErrorObject } from "./utils/helper.js";

try {
  await connectMongoose();

  const app = express();
  const port = process.env.PORT || 4000;
  const origins = process.env.ALLOWED_ORIGINS.split(",");

  app.use(cors({ origin: origins, credentials: true }));
  app.use(cookieParser(process.env.COOKIE_SECRET));
  app.use(helmet());

  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/oauth", oauthRoutes);

  app.use(verifyCsrfOrigin, validateSession);
  app.use("/api/uploads", uploadRoutes);
  app.use("/api/import", importDriveRoutes);
  app.use("/api/user", homeRoutes);
  app.use("/api/files", fileRoutes);
  app.use("/api/directories", directoryRoutes);
  app.use("/api/admin", adminRoutes);

  // 404 handler
  app.use((req, res, next) => {
    return next(getErrorObject("Route not available.", 404));
  });

  app.use(errorHandler);

  app.listen(port, () => {
    console.info("Server Started at PORT :", port);
  });
} catch (err) {
  console.info({ [err.name]: err.message });
  process.exit(1);
}
