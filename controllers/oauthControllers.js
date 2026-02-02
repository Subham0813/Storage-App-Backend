import crypto from "crypto";
import mongoose from "mongoose";

import { google } from "googleapis";
import { User } from "../models/user.model.js";
import { Directory } from "../models/directory.model.js";
import { createSession } from "../utils/createSession.js";
import { DriveIntegration } from "../models/integration.model.js";

const github_client_id = process.env.GITHUB_CLIENT_ID || "Ov23lidhcTGC5plM2W6v";

const github_redirect_uri =
  process.env.GITHUB_REDIRECT_URI ||
  "http://localhost:4000/auth/github/callback";

const github_client_secret =
  process.env.GITHUB_CLIENT_SECRET ||
  "bdedf19598cabd15076909fa1dbf2b912d0bddf1";

const google_client_id =
  process.env.GOOGLE_CLIENT_ID ||
  "19238739219-dl25hbv2fvs54pb7vr5ah3aop5acrflc.apps.googleusercontent.com";

const google_redirect_uri =
  process.env.GOOGLE_REDIRECT_URI ||
  "http://localhost:4000/oauth/google/callback";

const google_drive_redirect_uri =
  process.env.GOOGLE_DRIVE_REDIRECT_URI ||
  "http://localhost:4000/oauth/google-drive/callback";

const google_client_secret =
  process.env.GOOGLE_CLIENT_SECRET || "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";

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

const fetchTokenIdGithub = async (code, codeVerifier) => {
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

const fetchUserGithub = async (accessToken) => {
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

export const googleOAuthHandler = async (req, res, next) => {
  try {
    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = generatePKCE();

    res.cookie("oauth_state_google", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });

    res.cookie("oauth_pkce_google", codeVerifier, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });

    if (req.user?._id) {
      console.log("userId found....");
      res.cookie("oauth_user_google", req.user._id, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
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

export const googleOAuthCallbackHandler = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    const savedState = req.cookies.oauth_state_google;
    const codeVerifier = req.cookies.oauth_pkce_google;
    const userId = req.cookies.oauth_user_google;

    console.log({ userId });

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

    let user;
    if (!userId) {
      user = await User.findOne({
        authProvider: { $in: ["google"] },
        authId: sub,
      });

      if (!user && email) {
        user = await User.findOne({ email });
      }
    } else {
      user = await User.findById(userId);
      console.log(user);
    }

    if (!user) {
      user = await User.create({
        authProvider: ["google"],
        googleId: sub,
        email,
        username: email.split("@")[0],
        name,
        avatar: picture,
        emailVerified: email_verified,
      });

      const root = await Directory.create({
        name: `root-${user.username}`,
        parentId: new mongoose.Types.ObjectId(),
        userId: user._id,
      });

      user.rootDirId = root._id;
    } else {
      if (!user.googleId) user.googleId = sub;
      if (!user.authProvider.includes("google")) {
        user.authProvider.push("google");
      }
    }

    await user.save();
    if (!userId) await createSession(user, res);

    return res.redirect(`http://localhost:5173/dashboard?google=connected`);
  } catch (err) {
    next(err);
  }
};

export const githubOAuthHandler = async (req, res, next) => {
  try {
    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = generatePKCE();

    // CSRF state
    res.cookie("oauth_state_github", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });

    // PKCE verifier
    res.cookie("oauth_pkce_github", codeVerifier, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });

    if (req.user?._id) {
      console.log("userId found....");
      res.cookie("oauth_user_github", req.user._id, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
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

export const githubOAuthCallbackHandler = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    const savedState = req.cookies.oauth_state_github;
    const codeVerifier = req.cookies.oauth_pkce_github;

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

    const accessToken = await fetchTokenIdGithub(code, codeVerifier);
    const payload = await fetchUserGithub(accessToken);

    const { id, name, email, login, avatar_url } = payload;

    let user = await User.findOne({
      githubId: id,
      authProvider: { $in: ["github"] },
    });

    if (!user && email) {
      user = await User.findOne({ email });
    }

    if (!user) {
      user = await User.create({
        authProvider: ["github"],
        githubId: id,
        username: login,
        email,
        name: name.length > 0 ? name : login,
        avatar: avatar_url,
      });

      const root = await Directory.create({
        name: `root-${user.username}`,
        parentId: new mongoose.Types.ObjectId(),
        userId: user._id,
      });

      user.rootDirId = root._id;
    } else {
      if (!user.githubId) user.githubId = id;

      if (!user.authProvider.includes("github")) {
        user.authProvider.push("github");
      }
    }

    await user.save();
    await createSession(user, res);

    return res.redirect(`http://localhost:5173/dashboard?github=connected`);
  } catch (err) {
    next(err);
  }
};

export const googleDriveOAuthHandler = async (req, res, next) => {
  try {
    const integration = await DriveIntegration.exists({
      userId: req.user._id,
      stateCreatedAt: { $exists: false },
    });

    if (integration)
      return res.status(409).json({
        success: false,
        statusCode: 409,
        error: "CONFLICT",
        message: "Drive already connected.",
      });

    const state = crypto.randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = generatePKCE();

    res.cookie("oauth_state_google", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });

    res.cookie("oauth_pkce_google", codeVerifier, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
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

export const googleDriveCallbackHandler = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    const savedState = req.cookies.oauth_state_google;
    const codeVerifier = req.cookies.oauth_pkce_google;

    if (!code || !state || !savedState || !codeVerifier) {
      return res.status(403).json({ message: "Invalid OAuth request.", error });
    }

    if (state !== savedState) {
      return res.status(403).json({ message: "OAuth state mismatch." });
    }

    res.clearCookie("oauth_state_google");
    res.clearCookie("oauth_pkce_google");

    const { tokens } = await googleDriveClient.getToken({
      code,
      codeVerifier,
    });

    if (!tokens.refresh_token) {
      throw new Error("No refresh token received");
    }

    await DriveIntegration.updateOne(
      { provider: "google-drive", state },
      {
        $set: {
          scope: tokens.scope,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: new Date(
            Date.now() + tokens.refresh_token_expires_in * 1000,
          ),
          updatedAt: new Date(),
        },
        $unset: { stateCreatedAt: "" },
      },
      { upsert: true },
    );

    return res.redirect(
      "http://localhost:5173/dashboard?google-drive=connected",
    );
  } catch (err) {
    next(err);
  }
};
