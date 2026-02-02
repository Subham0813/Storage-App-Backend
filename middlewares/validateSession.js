import mongoose from "mongoose";
import { Session } from "../models/session.model.js";
import { DriveIntegration } from "../models/integration.model.js";

const validateSession = async (req, res, next) => {
  const { sid } = req.signedCookies;
  const { state } = req.query;

  console.log({sid, state})

  // if (!sid && state) {
  //   console.log("inside validateSession");
  //   const integration = await DriveIntegration.exists({
  //     state: state
  //   })
  //     .populate("userId")
  //     .lean();

  //   if (integration) req.user = integration.userId;
  //   next();
  // }

  if (!sid || !mongoose.isValidObjectId(sid))
    return res
      .status(400)
      .json({ success: false, message: "Cookies not found." });

  try {
    const session = await Session.findOne({ _id: sid })
      .populate("userId")
      .lean();

    if (!session || !session.userId)
      return res
        .status(400)
        .json({ success: false, message: "Cookies expired." });

    req.user = session.userId;
    req.userSession = session;
    // req.uploadSession = session.userId;
    next();
  } catch (err) {
    next(err);
  }
};
export { validateSession };
