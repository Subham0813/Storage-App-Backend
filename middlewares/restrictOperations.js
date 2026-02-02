import mongoose from "mongoose";

export const restrictRootOperations = async (req, res, next) => {
  try {
    const rootId = req.user.rootDirId.toString();
    const id = req.params.id;

    if ((id && !mongoose.isValidObjectId(id)) || rootId === id) {
      return res
        .status(400)
        .json({
          message: "Operations on root directory are not allowed.",
          error: "ACCESS_DENIED",
        });
    }

    next();
  } catch (err) {
    next(err);
  }
};

export const checkAuthProviderStatus = (provider) => {
  return async (req, res, next) => {
    if (req.user.authProvider.includes(provider))
      return res.status(409).json({
        success: false,
        statusCode: 409,
        message: `Already connected with ${provider}.`,
        error: "CONFLICT",
      });
    next();
  };
};
