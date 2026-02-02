import { Session } from "../models/session.model.js";
import { getUserPayload } from "./helper.js";

const MAX_DEVICE_COUNT = process.env.MAX_DEVICE_COUNT || 2;

const createSession = async (user, res) => {
  if (!user || !res) return {};

  try {
    if (user.deviceCount < MAX_DEVICE_COUNT) {
      user.deviceCount = user.deviceCount + 1;
      await user.save();
    } else {
      await Session.deleteOne({ userId: user._id });
    }

    const { _id: sid, expiry } = await Session.create({ userId: user._id });

    const userPayload = getUserPayload(user);
    res.cookie("sid", sid, {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      signed: true,
      expires: new Date(expiry),
      path: "/",
    });

    return userPayload;
  } catch (err) {
    throw err;
  }
};

export { createSession };
