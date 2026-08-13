import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { redisClient } from "../configs/redis.js";
import { getErrorObject } from "../utils/helper.js";

const createLimiter = (
  maxRequests,
  windowMs = 15 * 60 * 1000,
  message = "Too many requests, please try again later.",
  prefix = "rl:",
) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: (req) => {
      // Use User ID if authenticated, otherwise fallback to IP address
      if (req.user && req.user._id) {
        return req.user._id.toString();
      }

      return ipKeyGenerator(req.ip);
    },
    handler: (req, res, next) => {
      next(getErrorObject(message, 429));
    },
    store: new RedisStore({
      prefix: prefix,
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
  });
};

// 1. Global Limiter (1000 reqs / 15 mins)
export const globalLimiter = createLimiter(
  1000,
  15 * 60 * 1000,
  "Too many requests from this IP, please try again after 15 minutes.",
  "rl_global:",
);

// 2. Auth Limiter (20 reqs / 15 mins)
export const authLimiter = createLimiter(
  20,
  15 * 60 * 1000,
  "Too many authentication attempts from this IP, please try again after 15 minutes.",
  "rl_auth:",
);

// 3. Upload Limiter (100 reqs / 15 mins)
export const uploadLimiter = createLimiter(
  100,
  15 * 60 * 1000,
  "Upload limit reached for this IP, please try again after 15 minutes.",
  "rl_upload:",
);

// 4. Public Link Limiter (200 reqs / 15 mins)
export const publicLinkLimiter = createLimiter(
  200,
  15 * 60 * 1000,
  "Too many requests to public links from this IP, please try again after 15 minutes.",
  "rl_public:",
);
