import { Router } from "express";
import { validateSession } from "../middlewares/validateSession.js";

import {
  githubOAuthHandler,
  githubOAuthCallbackHandler,
  googleDriveCallbackHandler,
  googleDriveOAuthHandler,
  googleOAuthCallbackHandler,
  googleOAuthHandler,
} from "../controllers/oauthControllers.js";

const router = Router();

//OAUTH
router.get("/google/connect", googleOAuthHandler);
router.get("/google/callback", googleOAuthCallbackHandler);

router.get("/github/connect", githubOAuthHandler);
router.get("/github/callback", githubOAuthCallbackHandler);

//Google Drive Flow
router.get("/google-drive/connect", validateSession, googleDriveOAuthHandler);
router.get("/google-drive/callback", googleDriveCallbackHandler);

export default router;
