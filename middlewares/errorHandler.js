import mongoose, { MongooseError } from "mongoose";
/**
 * Middleware: errorHandler
 * what it do: Centralized error handler that catches and formats various error types (Multer, Mongoose, MongoDB) and logs them.
 */
export const errorHandler = async (err, req, res, next) => {
  if (err instanceof MongooseError) {
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
      err.statusCode = 409
    } else {
      console.error(err);
    }
  } else if (err.code === "ENOENT") {
    console.error({ ...err });
  } else {
    if (!err.statusCode) console.error(err);
  }

  const { statusCode, customMessage } = err;
  return res
    .status(statusCode || 500)
    .json({
      success: false,
      message: customMessage || "Server error. Please try again later.",
    });
};
