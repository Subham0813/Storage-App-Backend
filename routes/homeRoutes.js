import { Router } from "express";

import {
  getBinDirectoryHandler,
  getRecentsHandler,
  DeleteProfileHandler,
  LogoutHandler,
  LogoutAllHandler,
  getSharedWithHandler,
  getUserHandler,
} from "../controllers/homeRouteControllers.js";
import {
  githubOAuthHandler,
  googleOAuthHandler,
} from "../controllers/oauthControllers.js";
import { checkAuthProviderStatus } from "../middlewares/restrictOperations.js";

const router = Router();

router.get("/bin", getBinDirectoryHandler);
router.get("/recents", getRecentsHandler);
router.get("/shared", getSharedWithHandler);
router.get("/user", getUserHandler);

router.put("/logout", LogoutHandler);
router.put("/logout-all", LogoutAllHandler);
router.delete("/delete-profile", DeleteProfileHandler);

//Link with OAUTH
router.get( "/link-google", checkAuthProviderStatus("google"), googleOAuthHandler );
router.get( "/link-github", checkAuthProviderStatus("google"), githubOAuthHandler );

export default router;
