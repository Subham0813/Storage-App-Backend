import { Router } from "express";
import {
  getNotifications,
  markAsRead,
  markAllRead,
  clearRead,
  getUnreadCount,
} from "../controllers/notificationControllers.js";

const router = Router();

router.get("/", getNotifications);
router.get("/unread-count", getUnreadCount);
router.put("/mark-all-read", markAllRead);
router.delete("/clear-read", clearRead);
router.put("/:id/read", markAsRead);

export default router;
