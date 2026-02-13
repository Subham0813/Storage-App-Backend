import mongoose, { MongooseError } from "mongoose";
import { MulterError } from "multer";
import { appendFile } from "node:fs/promises";

/**
 * Middleware: errorHandler
 * what it do: Centralized error handler that catches and formats various error types (Multer, Mongoose, MongoDB) and logs them.
 * requirements:
 *   - Must be attached as final error-handling middleware in Express app
 *   - Expects (err, req, res, next) signature for Express error handlers
 *   - Logs errors to error.log.json file if err.errorResponse exists
 */
export const errorHandler = async (err, req, res, next) => {
  // const errmsg =
  //   err?.errInfo?.details?.schemaRulesNotSatisfied[0]
  //     ?.propertiesNotSatisfied[0]?.details[0]?.reason ||
  //   err.errmsg ||
  //   err.message;
  // console.error(errmsg);
  if (err.errorResponse)
    try {
      await appendFile(
        "./error.log.json",
        JSON.stringify(err.errorResponse) + ",\n",
      );
    } catch (e) {
      console.error("Logging failed", e);
    }

  let statusCode;
  let error;
  let errorType;
  let message;

  if (err instanceof MulterError) {
    // A Multer error occurred when uploading.
    errorType = "MulterError";
    console.error("Multer error", err.name, err.message);
  }

  if (err instanceof MongooseError) {
    errorType = err.name;
    console.error({
      name: err.name,
      message: err.message,
      fields: err?.errors ? Object.keys(err.errors) : null,
      details: err?.errors
        ? Object.values(err.errors).map((e) => e.properties)
        : null,
    });
    // message = err.message.split(":").pop();
  }

  if (err instanceof mongoose.mongo.MongoError) {
    // errorType = err.name || err.code;

    if (err.code === 121) {
      console.error({
        name: err.name,
        code: err.code,
        message: err.errmsg,
        notSatisfied: {
          ...err?.errInfo?.details?.schemaRulesNotSatisfied[0]
            ?.propertiesNotSatisfied,
        },
        noSatisfiedDetails:
          err?.errInfo?.details?.schemaRulesNotSatisfied[0]
            ?.propertiesNotSatisfied?.[0]?.details,
      });
    }

    if (err.code === 11000) {
      console.error({
        name: err.name,
        code: err.code,
        message: err.errmsg,
        keyPattern: err.keyPattern,
        keyValue: err.keyValue,
      });

      statusCode = 409;
      const field = Object.keys(err.keyValue)[0];
      // message =
      //   field === "email"
      //     ? "User already registered."
      //     : `${field} already exists.`;
    }
  }

  if (err.code === "ENOENT") {
    console.error({ ...err });
  } else {
    console.error(err);
  }

  statusCode = 500;
  error = "ServerError";
  // errorType = err.code || err.name || undefined;
  message =
    err.customMessage || "Internal server error. Please try again later.";

  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    error,
  });
};
