import { Router } from "express";
import {
  getNotifications,
  markAsRead,
  markAllRead,
  getUnreadCount,
} from "../controllers/notificationControllers.js";

const router = Router();

router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.put("/mark-all-read", markAllRead);
router.put("/:id/read", markAsRead);

export default router;
