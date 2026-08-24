import crypto from "crypto";
import mongoose from "mongoose";

import {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_REDIRECT_URI,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_DRIVE_REDIRECT_URI,
  GOOGLE_REDIRECT_URI,
  t,
} from "../misc/constants.js";
import { google } from "googleapis";
import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";
import { redisClient } from "../configs/redis.js";
import { getBandwidthResetAt } from "../utils/bandwidthWindow.js";
import {
  getUserPayload,
  cookieOptions,
  getErrorObject,
  setCsrfCookie,
} from "../utils/helper.js";
import { authTokenSchema } from "../schemas/authSchema.js";

const googleClient = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
);

const googleDriveClient = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_DRIVE_REDIRECT_URI,
);

export const base64URLEncode = (buffer) =>
  buffer
    .toString("base64")
    .replaceAll(/\+/g, "-")
    .replaceAll(/\//g, "_")
    .replaceAll(/=/g, "");

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest();

const generatePKCE = () => {
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  const codeChallenge = base64URLEncode(sha256(codeVerifier));
  return { codeVerifier, codeChallenge };
};

const fiveMinMs = 5 * t._min * t._ms;
const sevenDays = 7 * t._day;
const sevenDayMs = 7 * t._day * t._ms;

const getGithubAccesToken = async (code, codeVerifier) => {
  try {
    const message = "error=invalid_code";
    if (!code || !codeVerifier) throw new Error(message);

    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
          code_verifier: codeVerifier,
        }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) throw new Error(message);

    const data = await response.json();
    if (!data || !data.access_token || data.token_type !== "bearer") {
      throw new Error(message);
    }

    return data;
  } catch (error) {
    throw error;
  }
};

const getGithubUserPayload = async (accessToken) => {
  try {
    if (!accessToken) throw new Error("error=no_access_token");

    const response = await fetch("https://api.github.com/user", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) throw new Error("error=no_payload");

    const data = await response.json();
    return data;
  } catch (error) {
    throw error;
  }
};

/**
 * path: /api/oauth/google/connect
 * what it do: Initiate Google OAuth flow by setting PKCE cookies and redirecting user to Google's authorization endpoint.
 * requirements:
 *   - req.user (optional): if authenticated, will be linked after successful authentication
 */
export const googleOAuthHandler = async (req, res, next) => {
  try {
    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = generatePKCE();

    const googleCookieData = {
      state,
      codeVerifier,
      session: req.user?.sessionId,
    };
    res.cookie(
      "oauth_google",
      googleCookieData,
      cookieOptions({ maxAge: fiveMinMs, sameSite: "lax" }),
    );

    const authUrl = googleClient.generateAuthUrl({
      response_type: "code",
      scope: ["openid", "email", "profile"],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    res.redirect(authUrl);
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/oauth/google/callback
 * what it do: Handle Google OAuth callback, verify id_token, create or update user, and establish session or link account.
 * requirements:
 *   - req.query: { code: string, state: string, error?: string }
 *   - req.cookies: { oauth_google }
 *   - Must have been initiated via /oauth/google/connect
 */
export const googleOAuthCallbackHandler = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    const {
      state: savedState,
      codeVerifier,
      session: userSession,
    } = req.signedCookies.oauth_google;

    if (
      error ||
      !code ||
      !state ||
      !savedState ||
      !codeVerifier ||
      state !== savedState
    ) {
      const err = new Error(error || "error=cookies_may_have_compromised");
      throw err;
    }
    res.clearCookie("oauth_google");

    const { tokens } = await googleClient.getToken({ code, codeVerifier });

    if (!tokens || !tokens.id_token) {
      const tErr = new Error("error=no_token_found");
      throw tErr;
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      const pErr = new Error("error=no_valid_email_found");
      throw pErr;
    }

    const { sub, email, name, picture, email_verified } = payload;

    if (!email_verified) {
      const vErr = new Error("error=email_not_verified");
      throw vErr;
    }

    let user = null;
    let root = null;
    if (userSession) {
      user = await User.findOne({ _id: userSession.id }).lean();
    } else {
      user = await User.findOne({ email }).lean();
    }

    const updateQuery = { $set: {} };
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (!user) {
          [user] = await User.create(
            [
              {
                authProviders: ["google"],
                googleId: sub,
                email,
                name,
                bandwidthResetAt: getBandwidthResetAt(),
                // avatar: picture,
              },
            ],
            { session },
          );

          [root] = await Directory.create(
            [
              {
                name: `root-${user.email}`,
                parentId: new mongoose.Types.ObjectId(),
                userId: user._id,
              },
            ],
            { session },
          );

          updateQuery.$set.root = root._id;
        } else {
          if (!user.googleId) {
            updateQuery.$set.googleId = sub;
          }

          if (!user.authProviders.includes("google")) {
            updateQuery.$push = { authProviders: { $each: ["google"] } };
          }
        }
        user = await User.findOneAndUpdate({ _id: user._id }, updateQuery, {
          session,
          returnDocument: "after",
        })
          .populate("root", "_id name size")
          .populate(
            "subscription",
            "user razorpaySubscriptionId planId planKey status currentPeriodStart currentPeriodEnd endedAt limits",
          )

          .lean();
      });
    } finally {
      await session.endSession();
    }

    if (!user) {
      const uErr = new Error("error=user_not_found");
      throw uErr;
    }

    if (user.isDeleted) throw new Error("error=account_banned");

    if (user.integrations) {
      user.integrations =
        Object.keys(user.integrations)?.map((i) => i.provider) || [];
    }

    const userdata = user;
    const userKey = `storageApp:user:${user._id}:userdata`;
    await Promise.all([
      redisClient.json.set(userKey, "$", userdata),
      redisClient.expire(userKey, 2 * t._min),
    ]);

    let token;
    if (!userSession) {
      const indexKey = `storageApp:user:${user._id}:session_index`;
      const sessionKeys = await redisClient.sMembers(indexKey);
      const maxDevices = user.subscription?.limits?.maxDevices || 2;

      if (user.isTwoFactorEnabled || sessionKeys.length >= maxDevices) {
        res.cookie(
          "authToken",
          { purpose: "login", id: user._id },
          cookieOptions({ maxAge: fiveMinMs, sameSite: "strict" }),
        );

        const flag = user.isTwoFactorEnabled
          ? "twoFactor=required"
          : "sessionLimit=true";

        return res.redirect(
          `${process.env.CLIENT_AUTH_CALLBACK_URL}/google?success=true&${flag}`,
        );
      }

      token = crypto.randomBytes(32).toString("hex");
      const sessionKey = `storageApp:user:${user._id}:session:${token}`;

      await Promise.all([
        redisClient.json.set(sessionKey, "$", {
          exp: sevenDays,
          createdAt: Date.now(),
          userAgent: req.headers["user-agent"] || "unknown",
        }),
        redisClient.sAdd(indexKey, sessionKey),
        redisClient.expire(indexKey, 7 * t._day),
      ]);
    } else {
      token = userSession.token;
    }

    res.cookie(
      "sessionId",
      { token, id: user._id },
      cookieOptions({ maxAge: sevenDayMs, sameSite: "lax" }),
    );
    setCsrfCookie(res);

    return res.redirect(
      `${process.env.CLIENT_AUTH_CALLBACK_URL}/google?success=true`,
    );
  } catch (err) {
    console.log(err);
    return res.redirect(
      `${process.env.CLIENT_AUTH_CALLBACK_URL}/google?$error=server_error`,
    );
  }
};

/**
 * path: /api/oauth/github/connect
 * what it do: Initiate GitHub OAuth flow by setting PKCE cookies and redirecting user to GitHub's authorization endpoint.
 * requirements:
 *   - req.user (optional): if authenticated, will be linked after successful authentication
 *   - No body parameters required
 */
export const githubOAuthHandler = async (req, res, next) => {
  try {
    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = generatePKCE();

    const githubCookieData = {
      state,
      codeVerifier,
      session: req.user?.sessionId,
    };
    res.cookie(
      "oauth_github",
      githubCookieData,
      cookieOptions({ maxAge: fiveMinMs, sameSite: "lax" }),
    );

    const authUrl =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${GITHUB_CLIENT_ID}` +
      `&redirect_uri=${GITHUB_REDIRECT_URI}` +
      `&scope=user:email` +
      `&state=${state}` +
      `&code_challenge=${codeChallenge}` +
      `&code_challenge_method=S256`;

    res.redirect(authUrl);
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/oauth/github/callback
 * what it do: Handle GitHub OAuth callback, exchange code for access token, fetch user profile, and create or update user account.
 * requirements:
 *   - req.query: { code: string, state: string, error?: string }
 *   - req.cookies: { oauth_github }
 *   - Must have been initiated via /oauth/github/connect
 */
export const githubOAuthCallbackHandler = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;
    const {
      state: savedState,
      codeVerifier,
      session: userSession,
    } = req.signedCookies.oauth_github;

    if (
      error ||
      !code ||
      !state ||
      !savedState ||
      !codeVerifier ||
      state !== savedState
    ) {
      const err = new Error(error || "error=cookies_may_have_compromised");
      throw err;
    }

    res.clearCookie("oauth_github");
    const { access_token: accessToken, ...rest } = await getGithubAccesToken(
      code,
      codeVerifier,
    );
    const payload = await getGithubUserPayload(accessToken);

    if (!payload || !payload.email)
      throw new Error("error=no_valid_email_found");

    const { id, name, email, login, avatar_url } = payload;
    let user = null;

    if (userSession) {
      user = await User.findOne({ _id: userSession.id })
        .populate("subscription", "limits")
        .lean();
    } else {
      user = await User.findOne({ email })
        .populate("subscription", "limits")
        .lean();
    }

    const updateQuery = { $set: {} };
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (!user) {
          [user] = await User.create(
            [
              {
                authProviders: ["github"],
                githubId: id,
                // username: login,
                email,
                name: name.length > 0 ? name : login,
                bandwidthResetAt: getBandwidthResetAt(),
                // avatar: avatar_url,
              },
            ],
            { session },
          );

          const [root] = await Directory.create(
            [
              {
                name: `root-${user.email}`,
                parentId: new mongoose.Types.ObjectId(),
                userId: user._id,
              },
            ],
            { session },
          );

          updateQuery.$set.root = root._id;
        } else {
          if (!user.githubId) {
            updateQuery.$set.githubId = id;
          }

          if (!user.authProviders.includes("github")) {
            updateQuery.$push = { authProviders: { $each: ["github"] } };
          }
        }

        await User.updateOne({ _id: user._id }, updateQuery, { session });
      });
    } finally {
      await session.endSession();
    }

    if (!user) throw new Error("error=user_not_found");

    if (user.isDeleted) throw new Error("error=account_banned");

    user.integrations = user.integrations?.map((i) => i.provider) || [];
    const userKey = `storageApp:user:${user._id}:userdata`;
    await Promise.all([
      redisClient.json.set(userKey, "$", user),
      redisClient.expire(userKey, 2 * t._min),
    ]);

    let token;
    if (!userSession) {
      const indexKey = `storageApp:user:${user._id}:session_index`;
      const sessionKeys = await redisClient.sMembers(indexKey);
      const maxDevices = user.subscription?.limits?.maxDevices || 2;

      if (user.isTwoFactorEnabled || sessionKeys.length >= maxDevices) {
        res.cookie(
          "authToken",
          { purpose: "login", id: user._id },
          cookieOptions({ maxAge: fiveMinMs, sameSite: "strict" }),
        );

        const flag = user.isTwoFactorEnabled
          ? "twoFactor=required"
          : "sessionLimit=true";

        return res.redirect(
          `${process.env.CLIENT_AUTH_CALLBACK_URL}/github?success=true&${flag}`,
        );
      }

      token = crypto.randomBytes(32).toString("hex");
      const sessionKey = `storageApp:user:${user._id}:session:${token}`;

      await Promise.all([
        redisClient.json.set(sessionKey, "$", {
          exp: sevenDays,
          createdAt: Date.now(),
          userAgent: req.headers["user-agent"] || "unknown",
        }),
        redisClient.sAdd(indexKey, sessionKey),
        redisClient.expire(sessionKey, 7 * t._day),
        redisClient.expire(indexKey, 7 * t._day),
      ]);
    } else {
      token = userSession.token;
    }

    res.cookie(
      "sessionId",
      { token, id: user._id },
      cookieOptions({ maxAge: sevenDayMs, sameSite: "lax" }),
    );
    setCsrfCookie(res);

    return res.redirect(
      `${process.env.CLIENT_AUTH_CALLBACK_URL}/github?success=true`,
    );
  } catch (err) {
    return res.redirect(
      `${process.env.CLIENT_AUTH_CALLBACK_URL}/github?error=server_error`,
    );
  }
};

/**
 * path: /api/oauth/google-drive/connect
 * what it do: Initiate Google Drive OAuth flow for file backup/import, setting PKCE and state, then redirect to Google's authorization endpoint.
 * requirements:
 *   - req.user: authenticated user object provided by `validateSession`
 *   - User must not already have a Google Drive integration connected
 */
export const googleDriveOAuthHandler = async (req, res, next) => {
  try {
    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = generatePKCE();

    const googleDriveCookieData = {
      state,
      codeVerifier,
      uid: req.user._id,
    };

    res.cookie(
      "oauth_google_drive",
      googleDriveCookieData,
      cookieOptions({ maxAge: fiveMinMs, sameSite: "lax" }),
    );

    const authUrl = googleDriveClient.generateAuthUrl({
      access_type: "offline", // for refresh token
      prompt: "consent", // ensures refresh token

      scope: ["https://www.googleapis.com/auth/drive.readonly"],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    res.redirect(authUrl);
  } catch (err) {
    next(err);
  }
};

/**
 * path: /api/oauth/google-drive/callback
 * what it do: Handle Google Drive OAuth callback, exchange code for refresh token, and store integration credentials.
 * requirements:
 *   - req.query: { code: string, state: string, error?: string }
 *   - req.cookies: { oauth_google_drive }
 *   - Must have been initiated via /oauth/google-drive/connect
 */
export const googleDriveCallbackHandler = async (req, res, next) => {
  const { code, state, error } = req.query;
  const {
    state: savedState,
    codeVerifier,
    uid,
  } = req.signedCookies.oauth_google_drive;

  try {
    if (
      error ||
      !code ||
      !state ||
      !savedState ||
      !codeVerifier ||
      state !== savedState
    ) {
      const err = new Error(error || "error=cookies_may_have_compromised");
      throw err;
    }
    res.clearCookie("oauth_google_drive");

    const { tokens, ...rest } = await googleDriveClient.getToken({
      code,
      codeVerifier,
    });

    if (!tokens || !tokens.refresh_token) {
      const err = new Error("error=no_refresh_token");
      throw err;
    }

    const user = await User.findOneAndUpdate(
      { _id: uid },
      {
        $set: {
          "integrations.googleDrive.accessToken": tokens.access_token,
          "integrations.googleDrive.refreshToken": tokens.refresh_token,
          "integrations.googleDrive.scope": tokens.scope,
          // "integrations.googleDrive.tokenType": tokens.token_type,
          "integrations.googleDrive.idToken": tokens.id_token,
          "integrations.googleDrive.expiryDate": new Date(tokens.expiry_date),
          "integrations.googleDrive.tokenExpiry": new Date(
            Date.now() + tokens.refresh_token_expires_in * 1000,
          ),
        },
      },
      { upsert: true, returnDocument: "after" },
    )
      .select("_id integrations")
      .lean();

    if (!user) {
      throw new Error("error=unable_to_create_integration:user_not_found");
    }
    const userKey = `storageApp:user:${user._id}:userdata`;
    await redisClient.del(userKey);

    return res.redirect(
      `${process.env.CLIENT_AUTH_CALLBACK_URL}/google-drive?success=true`,
    );
  } catch (err) {
    // console.log(err);
    return res.redirect(
      `${process.env.CLIENT_AUTH_CALLBACK_URL}/google-drive?error=server_error`,
    );
  }
};

/**
 * path: POST /api/auth/complete-oauth
 * what it do: Finishes an OAuth login that was paused for 2FA or the session limit.
 * Reads the short-lived `authToken` cookie, optionally evicts the oldest session, and creates the Redis stateful session.
 * requirements:
 *   - req.signedCookies.authToken: signed cookie with { purpose: "login", id }
 *   - req.body: { logoutLastSession?: boolean }
 */
export const completeOauthLoginHandler = async (req, res, next) => {
  try {
    const { authToken } = req.signedCookies;
    if (!authToken) return next(getErrorObject("Invalid cookies."));

    const { success, data } = await authTokenSchema.safeParseAsync(authToken);
    if (!success || data.purpose !== "login")
      return next(getErrorObject("Invalid session state."));

    const { logoutLastSession } = req.body;

    let user = await User.findById(data.id)
      .populate("root", "_id name size")
      .populate("subscription")
      .lean();
    if (!user) throw getErrorObject("User not found.", 404);

    if (user.isDeleted)
      throw getErrorObject(
        "Your account has been banned. Contact support.",
        403,
      );

    const indexKey = `storageApp:user:${data.id}:session_index`;
    const sessionKeys = await redisClient.sMembers(indexKey);
    const maxDevices = user.subscription?.limits?.maxDevices || 1;

    if (sessionKeys.length >= maxDevices) {
      if (logoutLastSession) {
        await redisClient.sRem(indexKey, sessionKeys[0]);
        await redisClient.del(sessionKeys[0]);
      } else {
        throw getErrorObject(
          "Session creation failed. Max. limit reached.",
          413,
        );
      }
    }

    res.clearCookie("authToken");
    const token = crypto.randomBytes(32).toString("hex");
    const userKey = `storageApp:user:${user._id}:userdata`;
    const sessionKey = `storageApp:user:${user._id}:session:${token}`;

    user = await User.findByIdAndUpdate(
      user._id,
      { $set: { lastLogin: new Date() } },
      { returnDocument: "after" },
    )
      .populate("root", "_id name size")
      .populate("subscription")
      .lean();

    await Promise.all([
      redisClient.json.set(userKey, "$", user),
      redisClient.json.set(sessionKey, "$", {
        exp: sevenDays,
        createdAt: Date.now(),
        userAgent: req.headers["user-agent"] || "unknown",
      }),
      redisClient.sAdd(indexKey, sessionKey),
      redisClient.expire(userKey, 2 * t._min),
      redisClient.expire(sessionKey, sevenDays),
      redisClient.expire(indexKey, sevenDays),
    ]);

    setCsrfCookie(res);
    return res
      .cookie(
        "sessionId",
        { token, id: user._id },
        cookieOptions({ maxAge: sevenDayMs, sameSite: "lax" }),
      )
      .status(201)
      .json({
        success: true,
        message: "Session created.",
        data: { user: await getUserPayload(user) },
      });
  } catch (err) {
    next(err);
  }
};
