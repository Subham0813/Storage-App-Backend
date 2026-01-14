import { Router } from "express";
import { validateSession } from "../middlewares/validateSession.js";
import {
  handleDeleteProfile,
  handleLogin,
  handleLogout,
  handleLogoutAll,
  handleRegister,
  handleRequestOTP,
  handleVerifyOTP,
  handleForgotPassword,
  handleForgotPasswordInit
} from "../controllers/authControllers.js";

const router = Router();

router.post("/forgot-password-init", handleForgotPasswordInit);
router.post("/forgot-password", handleForgotPassword);

router.post("/request-otp", handleRequestOTP);

router.post("/login", handleLogin);

router.post("/register", handleRegister);

router.post("/verify-otp", handleVerifyOTP);

router.post("/logout", validateSession, handleLogout);

router.post("/logout-all", validateSession, handleLogoutAll);

router.delete("/delete-profile", validateSession, handleDeleteProfile);

export default router;
