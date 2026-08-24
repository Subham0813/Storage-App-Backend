import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet, { contentSecurityPolicy } from "helmet";

import connectMongoose from "./configs/connect.js";
import { redisClient } from "./configs/redis.js";

import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import oauthRoutes from "./routes/oauthRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import fileRoutes from "./routes/fileRoutes.js";
import shareRoutes from "./routes/shareRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import importDriveRoutes from "./routes/importDriveRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";

import {
  validateSession,
  verifyCsrfOrigin,
} from "./middlewares/validateSession.js";
import { errorHandler } from "./middlewares/errorHandler.js";

import {
  globalLimiter,
  authLimiter,
  uploadLimiter,
  publicLinkLimiter,
} from "./middlewares/rateLimiter.js";

import { getErrorObject } from "./utils/helper.js";
import {
  requiredEnvVars,
  requiredSaaSVars,
  smtpEnvVars,
  EMAIL_PROVIDER,
  IS_SAAS_MODE,
} from "./misc/constants.js";
import requireSaasMode from "./middlewares/requireSaasMode.js";

import { bandwidthWebhook } from "./services/bandwidthWebhook.js";
import { razorpayWebhook } from "./services/razorpayWebhook.js";

// const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
// if (EMAIL_PROVIDER === "smtp") {
//   missingVars.push(...smtpEnvVars.filter((v) => !process.env[v]));
// } else if (!process.env.RESEND_API_KEY) {
//   missingVars.push("RESEND_API_KEY");
// }
// if (IS_SAAS_MODE) {
//   missingVars.push(...requiredSaaSVars.filter((v) => !process.env[v]));
//   if (
//     process.env.CDN_PROVIDER === "cloudflare" &&
//     !process.env.CLOUDFLARE_WEBHOOK_SECRET
//   ) {
//     missingVars.push("CLOUDFLARE_WEBHOOK_SECRET");
//   }
// }
// if (missingVars.length > 0) {
//   console.error(
//     "Missing required environment variables:",
//     missingVars.join(", "),
//   );
//   process.exit(1);
// }

try {
  await connectMongoose();
  const app = express();
  app.set("trust proxy", 1);
  const port = process.env.PORT || 4000;
  const origins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim());

  app.use(cors({ origin: origins, credentials: true }));
  app.use(cookieParser(process.env.COOKIE_SECRET));

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": contentSecurityPolicy.dangerouslyDisableDefaultSrc,
          "frame-ancestors": ["'none'"],
        },
      },
      xFrameOptions: { action: "deny" },
    }),
  );

  app.use(express.json({ limit: "1mb" }));

  app.use("/api/auth", authLimiter, authRoutes);
  app.use("/api/oauth", authLimiter, oauthRoutes);
  app.use("/api/public/shared", publicLinkLimiter, shareRoutes);

  app.post("/api/subscriptions/webhook", globalLimiter, razorpayWebhook);
  app.post("/api/files/webhook", globalLimiter, requireSaasMode, bandwidthWebhook);

  app.use(verifyCsrfOrigin, validateSession);
  app.use("/api/uploads", uploadLimiter, uploadRoutes);
  app.use("/api/subscriptions", globalLimiter, subscriptionRoutes);
  app.use("/api/import", globalLimiter, importDriveRoutes);
  app.use("/api/user", globalLimiter, userRoutes);
  app.use("/api/notifications", globalLimiter, notificationRoutes);
  app.use("/api/files", globalLimiter, fileRoutes);
  app.use("/api/directories", globalLimiter, directoryRoutes);
  app.use("/api/admin", globalLimiter, adminRoutes);

  // 404 handler
  app.use((req, res, next) => {
    return next(getErrorObject("Route not available.", 404));
  });

  app.use(errorHandler);

  const server = app.listen(port, async () => {
    console.info("Server Started at PORT :", port);
  });

  // Graceful shutdown
  const gracefulShutdown = async () => {
    server.close(async () => {
      try {
        await redisClient.quit();
        console.info("Redis disconnected.");
      } catch (err) {
        console.error("Error closing Redis:", err);
      }
      process.exit(0);
    });
  };

  process.on("SIGTERM", gracefulShutdown);
  process.on("SIGINT", gracefulShutdown);
} catch (err) {
  console.error({ [err.name]: err.message });
  process.exit(1);
}
