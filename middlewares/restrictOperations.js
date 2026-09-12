import mongoose from "mongoose";
import { getErrorObject } from "../utils/helper.js";
import { AUTH_CALLBACK } from "../controllers/oauthControllers.js";

/**
 * Middleware: restrictRoot
 * what it do: Prevent operations on user's root directory by checking if req.params.id matches user's root.
 * requirements:
 *   - req.params.id: directory id to check (Mongo ObjectId)
 *   - req.user.root: authenticated user's root directory id
 *   - Blocks if id matches root or id is invalid
 */
export const restrictRoot = async (req, res, next) => {
  try {
    const rootId = req.user?.root?.toString();
    const paramId = req.params?.id.toString();

    if ((paramId && !mongoose.isValidObjectId(paramId)) || rootId === paramId) {
      return next(getErrorObject("Forbidden.", 403));
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
 *   - req.user.authProviders: array of connected auth providers
 *   - Returns 409 CONFLICT if provider already connected
 */
export const checkAuthProviderStatus = (provider) => {
  return async (req, res, next) => {
    if (req.user.authProviders && req.user.authProviders.includes(provider))
      return res.redirect(
        `${AUTH_CALLBACK}/${provider}?success=true&message=already_connected`,
      );

    next();
  };
};
