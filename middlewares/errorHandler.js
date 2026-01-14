import mongoose, { MongooseError } from "mongoose";
import { MulterError } from "multer";

const errorHandler = async (err, req, res, next) => {
  // const errmsg =
  //   err?.errInfo?.details?.schemaRulesNotSatisfied[0]
  //     ?.propertiesNotSatisfied[0]?.details[0]?.reason ||
  //   err.errmsg ||
  //   err.message;
  // console.error(errmsg);
  // await appendFile("./error.log.json", JSON.stringify(err.errorResponse));
  let statusCode = 500;
  let errors = null;
  let message =
    err.customMessage || "Internal server error. Please try again later.";

  if (err instanceof MulterError) {
    // A Multer error occurred when uploading.
    console.error("Multer error", err.name, err.message);
  }

  if (err instanceof MongooseError) {
    console.error({
      name: err.name,
      message: err.message,
      fields: err?.errors ? Object.keys(err.errors) : null,
      details: err?.errors
        ? Object.values(err.errors).map((e) => e.properties)
        : null,
    });
    message = err.message.split(":").pop();
  }

  if (err instanceof mongoose.mongo.MongoError) {
    if (err.code === 121) {
      console.error({
        name: err.name,
        code: err.code,
        message: err.errmsg,
        notSatisfied: {
          ...err?.errInfo?.details?.schemaRulesNotSatisfied[0],
        },
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
      message =
        field === "email"
          ? "User already registerd."
          : `${field} already exists.`;
    }
  }

  if (err.code === "ENOENT") {
    console.error({ ...err });
  } else {
    console.error(err);
  }

  return res.status(statusCode).json({
    success: false,
    message,
    errors,
  });
};

export { errorHandler };
