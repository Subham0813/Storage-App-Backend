import { Router } from "express";
import {
  loginHandler,
  registerHandler,
  requestOtpHandler,
  verifyOtpHandler,
  forgotPasswordHandler,
  forgotPasswordInitHandler,
} from "../controllers/authControllers.js";

const router = Router();

//EMAIL - PASSWORD
router.post("/forgot-password-init", forgotPasswordInitHandler);
router.post("/forgot-password", forgotPasswordHandler);

router.post("/request-otp", requestOtpHandler);
router.post("/verify-otp", verifyOtpHandler);

router.post("/login", loginHandler);
router.post("/register", registerHandler);

export default router;
