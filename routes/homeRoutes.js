import { Router } from "express";

import {
  getBinDirectoryHandler,
  getRecentsHandler,
  handleDeleteProfile,
  handleLogout,
  handleLogoutAll,
} from "../controllers/homeRouteControllers.js";
import {
  githubOAuthHandler,
  googleOAuthHandler,
} from "../controllers/oauthControllers.js";
import { checkAuthProviderStatus } from "../middlewares/restrictOperations.js";
import { getUserPayload } from "../utils/helper.js";

const router = Router();

router.get("/bin", getBinDirectoryHandler);

router.get("/recents", getRecentsHandler);

router.get("/profile", async (req, res, next) => {
  const user = getUserPayload(req.user);
  res.status(200).json({ success: true, statusCode: 200, data: { user } });
});

router.post("/logout", handleLogout);
router.post("/logout-all", handleLogoutAll);
router.delete("/delete-profile", handleDeleteProfile);

//Link with OAUTH
router.get(
  "/link-google",
  checkAuthProviderStatus("google"),
  googleOAuthHandler,
);
router.get(
  "/link-github",
  checkAuthProviderStatus("google"),
  githubOAuthHandler,
);

export default router;
