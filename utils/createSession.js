import { Session } from "../models/session.model.js";
import { getUserPayload } from "./helper.js";

/**
 * Utility: createSession
 * what it do: Create a new session record in DB and set secure signed session cookie on response.
 * requirements:
 *   - user: User document with _id property
 *   - res: Express response object to set cookie
 *   - Creates Session with user._id and returns user payload with cookie set
 *   - Returns: user payload object for response to client
 */
export const createSession = async (user, res) => {
  try {
    const { _id: sid, expiry } = await Session.create({ userId: user._id });

    const userPayload = getUserPayload(user);
    res.cookie("sid", sid, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      signed: true,
      expires: new Date(expiry),
      path: "/",
    });

    return userPayload;
  } catch (err) {
    throw err;
  }
};

