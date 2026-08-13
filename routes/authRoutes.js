import { Router } from "express";
import {
  loginHandler,
  registerHandler,
  requestOtpHandler,
  verifyOtpHandler,
  forgotPasswordHandler,
  forgotPasswordInitHandler,
} from "../controllers/authControllers.js";
import {
  enable2FA,
  generate2FA,
  disable2FA,
  verifyTotpHandler,
} from "../controllers/twoFactorAuthControllers.js";
import { completeOauthLoginHandler } from "../controllers/oauthControllers.js";
import {
  validateSession,
  verifyCsrfOrigin,
} from "../middlewares/validateSession.js";

const router = Router();

//EMAIL - PASSWORD
router.post("/forgot-password-init", forgotPasswordInitHandler);
router.post("/forgot-password", forgotPasswordHandler);

router.post("/request-otp", requestOtpHandler);
router.post("/verify-otp", verifyOtpHandler);

router.post("/login", loginHandler);
router.post("/register", registerHandler);

router.get("/2fa/generate", verifyCsrfOrigin, validateSession, generate2FA);
router.post("/2fa/enable", verifyCsrfOrigin, validateSession, enable2FA);
router.post("/2fa/disable", verifyCsrfOrigin, validateSession, disable2FA);
router.post("/verify-totp", verifyTotpHandler);
router.post("/complete-oauth", completeOauthLoginHandler);

export default router;
