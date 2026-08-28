import crypto from "crypto";
import { redisClient } from "../configs/redis.js";
import { invalidateUser } from "../utils/responseCache.js";

import { User } from "../models/user.model.js";
import { ensureBandwidthWindow } from "../utils/bandwidthWindow.js";

const safeCompare = (a, b) => {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

export const bandwidthWebhook = async (req, res) => {
  try {
    const cfAuth = req.headers["x-cf-webhook-auth"];
    if (!cfAuth) {
      return res.status(403).json({ error: "Unauthorized Edge Request" });
    }

    const { token, bytesSent } = req.body;
    if (!token || !Number.isInteger(bytesSent) || bytesSent <= 0) {
      return res.status(200).send("Ignored");
    }

    // 1. Decode and verify the token to ensure hackers didn't spoof the Webhook
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const [payloadStr, providedSignature] = decoded.split("|");
    if (!payloadStr || !providedSignature) {
      return res.status(400).json({ error: "Malformed Token" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.CLOUDFLARE_WEBHOOK_SECRET)
      .update(payloadStr)
      .digest("hex");
    if (!safeCompare(providedSignature, expectedSignature)) {
      return res.status(400).json({ error: "Token Tampering Detected" });
    }

    // 2. Extract the User ID and accurately update the DB!
    let payload;
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      return res.status(400).json({ error: "Malformed Token" });
    }


    // Roll the user's 30-day bandwidth window forward if it has expired so
    // the $inc below lands inside a fresh window.
    const userDoc = await User.findById(payload.u, {
      bandwidthResetAt: 1,
    }).lean();
    if (!userDoc) {
      return res.status(200).send("Ignored");
    }
    await ensureBandwidthWindow(userDoc);

    const updateResult = await User.updateOne(
      { _id: payload.u, isDeleted: { $ne: true } },
      { $inc: { usedBandwidthQuota: bytesSent } },
    );
    if (updateResult.matchedCount === 0) {
      return res.status(200).send("Ignored");
    }

    // Optionally bust their specific Redis cache so the UI updates their quota bar
    await redisClient.del(`storageApp:user:${payload.u}:userdata`);
    await invalidateUser(payload.u);

    return res.status(200).send("Bandwidth Logged");
  } catch (err) {
    console.error("Bandwidth Webhook Error:", err);
    return res.status(500).send("Webhook Error");
  }
};
