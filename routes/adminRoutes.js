import { Router } from "express";
import {
  changeUserRole,
  deleteUser,
  getAllDeletedUsers,
  getAllUsers,
  getSingleUser,
  logoutUser,
  recoverUser,
  tempRemoveUser,
} from "../controllers/adminControllers.js";

const router = Router();

router.get("/users", getAllUsers);
router.get("/deleted-users", getAllDeletedUsers);
router.get("/user/:id", getSingleUser);

//NOTE: Admin & Super-admins can use GET /api/directories/ routes
// router.get("/directory/:id", getDirectory);

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
