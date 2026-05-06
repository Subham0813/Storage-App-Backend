import { Router } from "express";

import {
  githubOAuthHandler,
  googleOAuthHandler,
} from "../controllers/oauthControllers.js";

// Common Getters
import {
  getBinnedItems,
  getRecentItems,
  getSharedBy,
  getSharedWith,
  getStarredItems,
} from "../controllers/commonGetControllers.js";

// User specific actions
import {
  deleteIntegration,
  deleteProfileHandler,
  LogoutAllHandler,
  LogoutHandler,
} from "../controllers/userControllers.js";

import { checkAuthProviderStatus } from "../middlewares/restrictOperations.js";
import { getUserPayload } from "../utils/helper.js";

const router = Router();

router.get("/info", async (req, res, next) => {
  try {
    const user = getUserPayload(req.user);
    return res.status(200).json({ success: true, data: { user } });
  } catch (err) {
    next(err);
  }
});

router.get("/bin/files", getBinnedItems("file"));
router.get("/bin/dirs", getBinnedItems("dir"));

router.get("/recents/files", getRecentItems("file"));
router.get("/recents/dirs", getRecentItems("dir"));

router.get("/starred/files", getStarredItems("file"));
router.get("/starred/dirs", getStarredItems("dir"));

router.get("/shared/files", getSharedBy("file"));
router.get("/shared/dirs", getSharedBy("dir"));

router.get("/shared-with/files", getSharedWith("file"));
router.get("/shared-with/dirs", getSharedWith("dir"));

router.get(
  "/link-google",
  checkAuthProviderStatus("google"),
  googleOAuthHandler,
);
router.get(
  "/link-github",
  checkAuthProviderStatus("github"),
  githubOAuthHandler,
);

router.put("/logout", LogoutHandler);
router.put("/logout-all", LogoutAllHandler);
router.delete("/revoke-drive-integration", deleteIntegration);

router.delete("/delete-profile", deleteProfileHandler);

export default router;
