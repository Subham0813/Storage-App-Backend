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
  searchItems,
} from "../controllers/commonGetControllers.js";

// User specific actions
import {
  deleteIntegration,
  deleteProfileHandler,
  emptyTrash,
  feedbackHandler,
  getActivity,
  getActiveSessionsHandler,
  getUsage,
  getUserInfo,
  getUserStats,
  LogoutAllHandler,
  LogoutHandler,
  revokeSessionHandler,
  updateAvatar,
  updateName,
} from "../controllers/userControllers.js";

import { checkAuthProviderStatus } from "../middlewares/restrictOperations.js";
import { getErrorObject, getUserPayload } from "../utils/helper.js";

const router = Router();

router.get("/info", getUserInfo);

router.get("/sessions", getActiveSessionsHandler);

router.get("/stats", getUserStats);
router.get("/usage", getUsage);
router.get("/activity", getActivity);

router.get("/search/files", searchItems("file"));
router.get("/search/dirs", searchItems("dir"));

router.get("/bin/files", getBinnedItems("file"));
router.get("/bin/dirs", getBinnedItems("dir"));

router.get("/recents/files", getRecentItems("file"));
router.get("/recents/dirs", getRecentItems("dir"));

router.get("/starred/files", getStarredItems("file"));
router.get("/starred/dirs", getStarredItems("dir"));

router.get("/shared-by-me/files", getSharedBy("file"));
router.get("/shared-by-me/dirs", getSharedBy("dir"));

router.get("/shared-with-me/files", getSharedWith("file"));
router.get("/shared-with-me/dirs", getSharedWith("dir"));

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

router.post("/feedback", feedbackHandler);
router.patch("/update-name", updateName);

router.put("/update-avatar", updateAvatar);
router.put("/logout", LogoutHandler);
router.put("/logout-all", LogoutAllHandler);
router.put("/revoke-drive-integration", deleteIntegration);
router.put("/empty-trash", emptyTrash);

router.delete("/sessions/:sessionId", revokeSessionHandler);
router.delete("/delete-profile", deleteProfileHandler);

export default router;
