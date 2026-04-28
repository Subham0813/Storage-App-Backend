import crypto from "crypto";
import mongoose from "mongoose";

import {
  github_client_id,
  github_client_secret,
  github_redirect_uri,
  google_client_id,
  google_client_secret,
  google_drive_redirect_uri,
  google_redirect_uri,
  MAX_DEVICE_COUNT,
  TIME,
} from "../misc/constants.js";
import { google } from "googleapis";
import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";
import { DriveIntegration } from "../models/integration.model.js";
import { Session } from "../models/session.model.js";
import { getUserPayload } from "../utils/helper.js";
import { redisClient } from "../configs/radis.js";

const googleClient = new google.auth.OAuth2(
  google_client_id,
  google_client_secret,
  google_redirect_uri,
);

const googleDriveClient = new google.auth.OAuth2(
  google_client_id,
  google_client_secret,
  google_drive_redirect_uri,
);

export const base64URLEncode = (buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest();

const generatePKCE = () => {
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  const codeChallenge = base64URLEncode(sha256(codeVerifier));
  return { codeVerifier, codeChallenge };
};

const getGithubAccesToken = async (code, codeVerifier) => {
  const message = "error=invalid_code";
  if (!code || !codeVerifier) throw new Error(message);

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: github_client_id,
      client_secret: github_client_secret,
      code,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) throw new Error(message);

  const data = await response.json();
  if (!data || !data.access_token || data.token_type !== "bearer") {
    throw new Error(message);
  }

  return data;
};

const getGithubUserPayload = async (accessToken) => {
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
};

const cookieOptions = (MAX_AGE) => ({
  httpOnly: true,
  signed: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: MAX_AGE,
  path: "/",
});

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
      cookieOptions(TIME.FIVE_MINUTES),
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
  const { code, state, error } = req.query;
  const {
    state: savedState,
    codeVerifier,
    session: userSession,
  } = req.signedCookies.oauth_google;

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
    res.clearCookie("oauth_google");

    const { tokens } = await googleClient.getToken({ code, codeVerifier });

    if (!tokens.id_token) {
      throw new Error("error=no_token_found.");
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email)
      throw new Error("error=no_valid_email_found");

    const { sub, email, name, picture, email_verified } = payload;

    let user = null;
    if (userSession) {
      user = await User.findOne({ _id: userSession.id }).lean();
    } else {
      user = await User.findOne({ googleId: sub, email }).lean();
    }

    const updateQuery = { $set: { isLogged: true } };
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
                avatar: picture,
                isEmailVerified: email_verified ?? false,
                isLogged: true,
                deviceCount: 1,
              },
            ],
            { session },
          );

          const [root] = await Directory.create(
            [
              {
                name: `root-${user.username}`,
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

          updateQuery.$inc = {
            deviceCount: user.deviceCount < MAX_DEVICE_COUNT ? 1 : 0,
          };
        }
        await User.updateOne({ _id: user._id }, updateQuery, { session });
      });
    } finally {
      session.endSession();
    }

    if (!user) throw new Error("error=user_not_found");

    const userdata = getUserPayload(user);
    const userKey = `storageApp:user:${user._id}:userdata`;
    await Promise.all([
      redisClient.json.set(userKey, "$", userdata),
      redisClient.expire(userKey, 300),
    ]);

    let token;
    if (!userSession) {
      token = crypto.randomBytes(32).toString("hex");
      const indexKey = `storageApp:user:${user._id}:session_index`;
      const sessionKey = `storageApp:user:${user._id}:session:${token}`;
      await Promise.all([
        redisClient.set(sessionKey, Date.now(), { EX: 7 * 86400 }),
        redisClient.sAdd(indexKey, sessionKey),
        redisClient.expire(indexKey, 7 * 86400),
      ]);
    } else {
      token = userSession.token;
    }

    res.cookie(
      "sessionId",
      { token, id: user._id },
      cookieOptions(TIME.ONE_DAY * 7),
    );

    return res.redirect(`${process.env.CLIENT_URL}/google?google=connected`);
  } catch (err) {
    return res.redirect(`${process.env.CLIENT_URL}/google?${err.message}`);
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
      cookieOptions(TIME.FIVE_MINUTES),
    );

    const authUrl =
      `https://github.com/login/oauth/authorize` +
      `?client_id=${github_client_id}` +
      `&redirect_uri=${github_redirect_uri}` +
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
  const { code, state, error } = req.query;
  const {
    state: savedState,
    codeVerifier,
    session: userSession,
  } = req.signedCookies.oauth_github;

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
      user = await User.findOne({ _id: userSession.id }).lean();
    } else {
      user = await User.findOne({
        githubId: id,
        authProviders: { $in: ["github"] },
      }).lean();
    }

    const updateQuery = { $set: { isLogged: true } };
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (!user) {
          [user] = await User.create(
            [
              {
                authProviders: ["github"],
                githubId: id,
                username: login,
                email,
                name: name.length > 0 ? name : login,
                avatar: avatar_url,
                isLogged: true,
                deviceCount: 1,
              },
            ],
            { session },
          );

          const [root] = await Directory.create(
            [
              {
                name: `root-${user.username}`,
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

          updateQuery.$inc = {
            deviceCount: user.deviceCount < MAX_DEVICE_COUNT ? 1 : 0,
          };
        }

        await User.updateOne({ _id: user._id }, updateQuery, { session });
      });
    } finally {
      await session.endSession();
    }

    if (!user) throw new Error("error=user_not_found");

    const userdata = getUserPayload(user);
    const userKey = `storageApp:user:${user._id}:userdata`;
    await Promise.all([
      redisClient.json.set(userKey, "$", userdata),
      redisClient.expire(userKey, 300),
    ]);

    let token;
    if (!userSession) {
      token = crypto.randomBytes(32).toString("hex");
      const indexKey = `storageApp:user:${user._id}:session_index`;
      const sessionKey = `storageApp:user:${user._id}:session:${token}`;
      await Promise.all([
        redisClient.set(sessionKey, Date.now(), { EX: 7 * 86400 }),
        redisClient.sAdd(indexKey, sessionKey),
        redisClient.expire(indexKey, 7 * 86400),
      ]);
    } else {
      token = userSession.token;
    }

    res.cookie(
      "sessionId",
      { token, id: user._id },
      cookieOptions(TIME.ONE_DAY * 7),
    );

    return res.redirect(`${process.env.CLIENT_URL}/github?github=connected`);
  } catch (err) {
    return res.redirect(`${process.env.CLIENT_URL}/github?${err.message}`);
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
    const drive = req.user.integrations?.googleDrive;
    if (drive && Date.now() < new Date(drive.tokenExpiry).getTime()) {
      return res.redirect(`${process.env.CLIENT_URL}?google-drive=connected`);
    }

    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = generatePKCE();

    const googleDriveCookieData = {
      state,
      codeVerifier,
      session: req.user?.sessionId,
    };
    res.cookie(
      "oauth_google_drive",
      googleDriveCookieData,
      cookieOptions(TIME.FIVE_MINUTES),
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
    session: userSession,
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

    const { access_token, refresh_token, scope, refresh_token_expires_in } =
      tokens;

    const user = await User.findOneAndUpdate(
      { _id: userSession.id },
      {
        $set: {
          "integrations.googleDrive.accessToken": access_token,
          "integrations.googleDrive.refreshToken": refresh_token,
          "integrations.googleDrive.tokenExpiry": new Date(
            Date.now() + refresh_token_expires_in * 1000,
          ),
        },
        $unset: { stateCreatedAt: "" },
      },
      { upsert: true, returnDocument: "after" },
    )
      .select("_id")
      .lean();

    if (!user) {
      throw new Error("error=unable_to_create_integration:user_not_found");
    }

    return res.redirect(
      `${process.env.CLIENT_URL}/google-drive?google-drive=connected`,
    );
  } catch (err) {
    return res.redirect(
      `${process.env.CLIENT_URL}/google-drive?${err.message}`,
    );
  }
};
