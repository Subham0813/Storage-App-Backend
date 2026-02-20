import mongoose, { MongooseError } from "mongoose";
import { MulterError } from "multer";
import { appendFile } from "node:fs/promises";
import crypto from "crypto";
/**
 * Middleware: errorHandler
 * what it do: Centralized error handler that catches and formats various error types (Multer, Mongoose, MongoDB) and logs them.
 * requirements:
 *   - Must be attached as final error-handling middleware in Express app
 *   - Expects (err, req, res, next) signature for Express error handlers
 *   - Logs errors to error.log.json file if err.errorResponse exists
 */
export const errorHandler = async (err, req, res, next) => {
  // Build a comprehensive error log entry
  const logEntry = {
    id: crypto.randomUUID().replaceAll("-", ""),
    timestamp: new Date().toISOString(),
    url: req.originalUrl,
    method: req.method,
    user: req.user ? req.user.email || req.user._id : undefined,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      details: err?.details || err?.errInfo || undefined,
      status: err.status || undefined,
      type: err.constructor ? err.constructor.name : undefined,
    },
    requestBody: req.body,
    query: req.query,
    params: req.params,
  };
  try {
    await appendFile("./error.log.json", JSON.stringify(logEntry) + ",\n");
  } catch (e) {
    console.error("Logging failed", e);
  }
  // const errmsg =
  //   err?.errInfo?.details?.schemaRulesNotSatisfied[0]
  //     ?.propertiesNotSatisfied[0]?.details[0]?.reason ||
  //   err.errmsg ||
  //   err.message;
  // console.error(errmsg);

  // Print error to console for debugging
  if (err instanceof MulterError) {
    console.error("Multer error", err.name, err.message, "\n", err);
  } else if (err instanceof MongooseError) {
    console.error({
      name: err.name,
      message: err.message,
      fields: err?.errors ? Object.keys(err.errors) : null,
      details: err?.errors
        ? Object.values(err.errors).map((e) => e.properties)
        : null,
    });
  } else if (err instanceof mongoose.mongo.MongoError) {
    if (err.code === 121) {
      console.error({
        name: err.name,
        code: err.code,
        message: err.errmsg,
        notSatisfied: {
          ...err?.errInfo?.details?.schemaRulesNotSatisfied[0],
        },
        notSatisfiedDetails:
          err?.errInfo?.details?.schemaRulesNotSatisfied[0]
            ?.propertiesNotSatisfied?.[0]?.details,
      });
    } else if (err.code === 11000) {
      console.error({
        name: err.name,
        code: err.code,
        message: err.errmsg,
        keyPattern: err.keyPattern,
        keyValue: err.keyValue,
      });
    } else {
      console.error(err);
    }
  } else if (err.code === "ENOENT") {
    console.error({ ...err });
  } else {
    console.error(err);
  }

  // statusCode = 500;
  // error = "ServerError";
  // errorType = err.code || err.name || undefined;
  // message = "Internal server error. Please try again later.";

  // Respond with a generic error message
  return res.status(500).json({
    success: false,
    statusCode: 500,
    message: "Internal server error. Please try again later.",
    error: logEntry.error.name || "ServerError",
    errorId: logEntry.id,
  });
};
