import mongoose from "mongoose";
import { Session } from "../models/session.model.js";

const validateSession = async (req, res, next) => {
  const {sid} = req.signedCookies;

  if (!sid || !mongoose.isValidObjectId(sid))
    return res
      .status(400)
      .json({ success: false, message: "Cookies not found." });

  try {
    const session = await Session.findOne({ _id: sid })
      .populate("userId")
      .lean();

    if (!session)
      return res
        .status(400)
        .json({ success: false, message: "Cookies expired." });

    req.user = session.userId;
    req.userSession = session
    // req.uploadSession = session.userId;
    next();
  } catch (err) {
    next(err);
  }
};
export { validateSession };
