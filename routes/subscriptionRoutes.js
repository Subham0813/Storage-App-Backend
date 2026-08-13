import { Router } from "express";
import {
  createSubscription,
  getPlanOptions,
  getCurrentPlan,
  verifySubscriptionSignature,
  updateSubscriptionPlan,
  cancelSubscriptionPlan,
  getSubscriptionHistory,
} from "../controllers/subscriptionControllers.js";
import requireSaasMode from "../middlewares/requireSaasMode.js";

const router = Router();

router.use(requireSaasMode);

router.get("/plans", getPlanOptions);
router.get("/current-plan", getCurrentPlan);
router.get("/history", getSubscriptionHistory);

router.post("/create", createSubscription);
router.post("/verify", verifySubscriptionSignature);
router.patch("/update", updateSubscriptionPlan);
router.patch("/cancel", cancelSubscriptionPlan);

export default router;
