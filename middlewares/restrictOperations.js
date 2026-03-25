import mongoose from "mongoose";
import { forbidden } from "../utils/helper.js";

/**
 * Middleware: restrictRootOperations
 * what it do: Prevent operations on user's root directory by checking if req.params.id matches user's root.
 * requirements:
 *   - req.params.id: directory id to check (Mongo ObjectId)
 *   - req.user.root: authenticated user's root directory id
 *   - Blocks if id matches root or id is invalid
 */
export const restrictRootOperations = async (req, res, next) => {
  try {
    const rootId = req.user?.root?.toString();
    const paramId = req.params?.id.toString();

    if ((paramId && !mongoose.isValidObjectId(paramId)) || rootId === paramId) {
      return forbidden(res);
    }

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware factory: checkAuthProviderStatus
 * what it do: Check if user is already authenticated with a specific provider (OAuth), prevent duplicate connections.
 * requirements:
 *   - provider: string like 'google' or 'github'
 *   - req.user.authProvider: array of connected auth providers
 *   - Returns 409 CONFLICT if provider already connected
 */
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
