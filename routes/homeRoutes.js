import { Router } from "express";
import {
  getBinDirectoryHandler,
  getRecentsHandler,
  deleteProfileHandler,
  LogoutHandler,
  LogoutAllHandler,
  getSharedWithHandler,
  getUserHandler,
  deleteDriveIntegration,
  getStarredItems,
} from "../controllers/homeRouteControllers.js";
import {
  githubOAuthHandler,
  googleOAuthHandler,
} from "../controllers/oauthControllers.js";
import { checkAuthProviderStatus } from "../middlewares/restrictOperations.js";

const getStorageInfo = () => {
  return (req, res, next) => {
    const { allotedStorage, usedStorage } = req.user;
    try {
      res.status(200).json({ data: { allotedStorage, usedStorage } });
    } catch (err) {
      next(err);
    }
  };
};

const router = Router();

router.get("/bin", getBinDirectoryHandler);
router.get("/recents", getRecentsHandler);
router.get("/shared", getSharedWithHandler);
router.get("/user", getUserHandler);
router.get("/starred", getStarredItems);
router.get("/storage-info", getStorageInfo());
router.get("/link-google", checkAuthProviderStatus("google"), googleOAuthHandler);
router.get("/link-github", checkAuthProviderStatus("google"), githubOAuthHandler);

router.patch("/revoke-drive-integration", deleteDriveIntegration)
router.patch("/logout", LogoutHandler);
router.patch("/logout-all", LogoutAllHandler);

router.delete("/google-drive", deleteDriveIntegration);
router.delete("/delete-profile", deleteProfileHandler);

export default router;
