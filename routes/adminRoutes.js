import { Router } from "express";
import {
  changeUserRole,
  deleteUser,
  getDashboardStats,
  getAllUsers,
  getSingleUser,
  getUserActivity,
  getUserFeedbacks,
  logoutUser,
  recoverUser,
  replyToFeedback,
  sendUserEmail,
  tempRemoveUser,
  updateFeedback,
} from "../controllers/adminControllers.js";
import { getUserStats } from "../controllers/userControllers.js";

const router = Router();

router.get("/dashboard", getDashboardStats);
router.get("/users", getAllUsers);
router.get("/user/:id", getSingleUser);
router.get("/storage/:id", getUserStats);

router.get("/user/:id/activity", getUserActivity);
router.post("/user/:id/email", sendUserEmail);

router.get("/feedback/:userId", getUserFeedbacks);
router.patch("/feedback/:feedbackId", updateFeedback);
router.post("/feedback/:feedbackId/reply", replyToFeedback);

// super-admin can promote/demote all users, admins are restricted to user and guests
router.patch("/change-role/:id", changeUserRole);

//super-admin can logout all users, admins are restricted to user and guests
router.patch("/logout-user/:id", logoutUser);

//super-admin can soft-delete all users, admins are restricted to user and guests
router.patch("/remove-user/:id", tempRemoveUser);

//super-admin only
router.patch("/recover-user/:id", recoverUser);
router.delete("/delete-user/:id", deleteUser);

export default router;
