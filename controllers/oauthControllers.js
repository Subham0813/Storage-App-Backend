import crypto from "crypto";
import mongoose from "mongoose";

import { TIME } from "../misc/constants.js";
import { google } from "googleapis";
import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";
import { createSession } from "../utils/createSession.js";
import { DriveIntegration } from "../models/integration.model.js";
import { Session } from "../models/session.model.js";
import { responsePayload } from "../utils/helper.js";

const github_client_id = process.env.GITHUB_CLIENT_ID;
const github_redirect_uri = process.env.GITHUB_REDIRECT_URI;
const github_client_secret = process.env.GITHUB_CLIENT_SECRET;

const google_client_id = process.env.GOOGLE_CLIENT_ID;
const google_redirect_uri = process.env.GOOGLE_REDIRECT_URI;
const google_client_secret = process.env.GOOGLE_CLIENT_SECRET;

const google_drive_redirect_uri = process.env.GOOGLE_DRIVE_REDIRECT_URI;

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

/**
 * path: /api/oauth/google/connect
 * what it do: Initiate Google OAuth flow by redirecting user to Google's authorization endpoint.
 * requirements:
 *   - req.user (optional): if authenticated, will be linked after successful authentication
 *   - No body parameters required
 */
const getGithubAccesToken = async (code, codeVerifier) => {
  if (!code || !codeVerifier) {
    throw new Error("Missing OAuth parameters");
  }

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

  if (!response.ok) {
    throw new Error("GitHub token exchange failed");
  }

  const data = await response.json();

  if (!data.access_token || data.token_type !== "bearer") {
    throw new Error("Invalid token response from GitHub");
  }

  return data.access_token;
};

const getGithubUserPayload = async (accessToken) => {
  if (!accessToken) return null;
  const response = await fetch("https://api.github.com/user", {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  return data;
};

/**
 * path: /api/oauth/google/connect
 * what it do: Initiate Google OAuth flow by setting PKCE cookies and redirecting user to Google's authorization endpoint.
 * requirements:
 *   - req.user (optional): if authenticated, will be linked after successful authentication
 *   - No body parameters required
 */
export const googleOAuthHandler = async (req, res, next) => {
  try {
    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = generatePKCE();

    res.cookie("oauth_state_google", state, {
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: TIME.TEN_MINUTES,
    });

    res.cookie("oauth_pkce_google", codeVerifier, {
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: TIME.TEN_MINUTES,
    });

    if (req.user?._id) {
      res.cookie("oauth_user_google", req.user._id, {
        httpOnly: true,
        signed: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: TIME.TEN_MINUTES,
      });
    }

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
 *   - req.cookies: { oauth_state_google, oauth_pkce_google, oauth_user_google? }
 *   - Must have been initiated via /oauth/google/connect
 */
export const googleOAuthCallbackHandler = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    const savedState = req.signedCookies.oauth_state_google;
    const codeVerifier = req.signedCookies.oauth_pkce_google;
    const userId = req.signedCookies.oauth_user_google;

    if (!code || !state || !savedState || !codeVerifier) {
      return res.status(403).json({ message: "Invalid OAuth request.", error });
    }

    if (state !== savedState) {
      return res.status(403).json({ message: "OAuth state mismatch." });
    }

    res.clearCookie("oauth_state_google");
    res.clearCookie("oauth_pkce_google");
    res.clearCookie("oauth_user_google");

    // Exchange code → tokens using PKCE verifier
    const { tokens } = await googleClient.getToken({
      code,
      codeVerifier,
    });

    if (!tokens.id_token) {
      throw new Error("Missing id_token");
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload || !payload.email_verified) {
      return res.status(403).json({ message: "Unverified Google account." });
    }

    const { sub, email, name, picture, email_verified } = payload;

    let user = null;

    if (!userId) {
      user = await User.findOne({
        authProviders: { $in: ["google"] },
        authId: sub,
      });

      if (!user && email) {
        user = await User.findOne({ email });
      }
    } else user = await User.findById(userId);

    const updateQuery = { $set: {} };
    const session = await mongoose.startSession();
    let userSession = null;

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
                isEmailVerified: email_verified,
              },
            ],
            { session },
          );

          const [root] = await Directory.create(
            [
              {
                dirname: `root-${user.username}`,
                parentId: new mongoose.Types.ObjectId(),
                userId: user._id,
              },
            ],
            { session },
          );

          updateQuery.$set.root = root._id;
        } else {
          if (!user.googleId) updateQuery.$set.googleId = sub;
          if (!user.authProviders.includes("google"))
            updateQuery.$push = { authProviders: { $each: ["google"] } };
        }

        updateQuery.$set.isLogged = true;
        await User.findByIdAndUpdate(user._id, updateQuery, { session });

        if (!userId) {
          [userSession] = await Session.create([{ userId: user._id }], {
            session,
          });
        }
      });
    } finally {
      session.endSession();
    }

    if (userSession) {
      const { _id: sid, expiry } = userSession;

      res.cookie("sid", sid, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        signed: true,
        expires: new Date(expiry),
        path: "/",
      });
    }

    return res.redirect(
      `http://localhost:5173/auth/callback/google?google=connected`,
    );
  } catch (err) {
    next(err);
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

    // CSRF state
    res.cookie("oauth_state_github", state, {
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: TIME.TEN_MINUTES,
    });

    // PKCE verifier
    res.cookie("oauth_pkce_github", codeVerifier, {
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: TIME.TEN_MINUTES,
    });

    if (req.user?._id) {
      console.log("userId found....");
      res.cookie("oauth_user_github", req.user._id, {
        httpOnly: true,
        signed: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: TIME.TEN_MINUTES,
      });
    }

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
 *   - req.cookies: { oauth_state_github, oauth_pkce_github, oauth_user_github? }
 *   - Must have been initiated via /oauth/github/connect
 */
export const githubOAuthCallbackHandler = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    const savedState = req.signedCookies.oauth_state_github;
    const codeVerifier = req.signedCookies.oauth_pkce_github;
    const userId = req.signedCookies.oauth_user_google;

    if (!code || !state || !savedState || !codeVerifier) {
      return res.status(403).json({ message: "Invalid OAuth request.", error });
    }

    if (state !== savedState) {
      return res.status(403).json({
        message: "Security Alert: OAuth state mismatch.",
      });
    }

    // Cleanup
    res.clearCookie("oauth_state_github");
    res.clearCookie("oauth_pkce_github");
    res.clearCookie("oauth_user_github");

    const accessToken = await getGithubAccesToken(code, codeVerifier);
    const payload = await getGithubUserPayload(accessToken);

    const { id, name, email, login, avatar_url } = payload;

    let user;
    if (!userId) {
      user = await User.findOne({
        githubId: id,
        authProviders: { $in: ["github"] },
      });

      if (email && !user) {
        user = await User.findOne({ email });
      }
    } else user = await User.findById(userId);

    const updateQuery = { $set: {} };
    const session = await mongoose.startSession();
    let userSession = null;

    try {
      await session.withTransaction(async () => {
        if (!user) {
          user = await User.create({
            authProviders: ["github"],
            githubId: id,
            username: login,
            email,
            name: name.length > 0 ? name : login,
            avatar: avatar_url,
          });

          const root = await Directory.create({
            dirname: `root-${user.username}`,
            parentId: new mongoose.Types.ObjectId(),
            userId: user._id,
          });

          updateQuery.$set.root = root._id;
        } else {
          if (!user.githubId) updateQuery.$set.githubId = id;
          if (!user.authProviders.includes("github"))
            updateQuery.$push = { authProviders: { $each: ["github"] } };
        }

        updateQuery.$set.isLogged = true;
        await User.findByIdAndUpdate(user._id, updateQuery, { session });

        if (!userId) {
          [userSession] = await Session.create([{ userId: user._id }], {
            session,
          });
        }
      });
    } finally {
      await session.endSession();
    }

    if (userSession) {
      const { _id: sid, expiry } = userSession;

      res.cookie("sid", sid, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        signed: true,
        expires: new Date(expiry),
        path: "/",
      });
    }

    return res.redirect(
      `http://localhost:5173/auth/callback/github?github=connected`,
    );
  } catch (err) {
    next(err);
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
    const integration = await DriveIntegration.exists({
      userId: req.user._id,
      stateCreatedAt: { $exists: false },
    });

    if (integration)
      return res.redirect(
        "http://localhost:5173/auth/callback/google-drive?google-drive=connected",
      );

    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = generatePKCE();

    res.cookie("oauth_state_google", state, {
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: TIME.TEN_MINUTES,
    });

    res.cookie("oauth_pkce_google", codeVerifier, {
      httpOnly: true,
      signed: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: TIME.TEN_MINUTES,
    });

    const authUrl = googleDriveClient.generateAuthUrl({
      access_type: "offline", // for refresh token
      prompt: "consent", // ensures refresh token

      scope: ["https://www.googleapis.com/auth/drive.readonly"],
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    await DriveIntegration.create({
      userId: req.user._id,
      provider: "google-drive",
      state,
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
 *   - req.cookies: { oauth_state_google, oauth_pkce_google }
 *   - Must have been initiated via /oauth/google-drive/connect
 */
export const googleDriveCallbackHandler = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    const savedState = req.signedCookies.oauth_state_google;
    const codeVerifier = req.signedCookies.oauth_pkce_google;

    if (!code || !state || !savedState || !codeVerifier) {
      return res.status(403).json({ message: "Invalid OAuth request.", error });
    }

    if (state !== savedState) {
      return res.status(403).json({ message: "OAuth state mismatch." });
    }

    res.clearCookie("oauth_state_google");
    res.clearCookie("oauth_pkce_google");

    const { tokens, ...rest } = await googleDriveClient.getToken({
      code,
      codeVerifier,
    });

    if (!tokens.refresh_token) {
      throw new Error("No refresh token received");
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const drive = await DriveIntegration.findOneAndUpdate(
          { provider: "google-drive", state },
          {
            $set: {
              scope: tokens.scope,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              expiresIn: new Date(
                Date.now() + tokens.refresh_token_expires_in * 1000,
              ),
            },
            $unset: { stateCreatedAt: "" },
          },
          { upsert: true, new: true },
        ).lean();

        if (!drive) {
          const error = new Error("Drive intregation failed.");
          error.statusCode = 500;
          throw error;
        }
      });
    } finally {
      session.endSession();
    }

    return res.redirect(
      `http://localhost:5173/auth/callback/google-drive?google-drive=connected`,
    );
  } catch (err) {
    if (err.statusCode)
      return responsePayload(res, err.statusCode, err.message);
    next(err);
  }
};
