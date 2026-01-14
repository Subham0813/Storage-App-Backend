import { Router } from "express";
import { createToken } from "../utils/createToken.js";
import { Db } from "mongodb";
import User from "../models/user.model.js";

const router = Router();

router.post("/login", async (req, res, next) => {
  const { email, password } = req.body;

  try {
    const user = await User.exists({
      email: email.toLowerCase().trim(),
      password: password,
    });

    if (!user) return res.status(404).json({ error: "Invalid Cradentials!!" });

    const token = await createToken(user._id);
    res.cookie("uid", token.secrete, {
      httpOnly: true,
      sameSite: "lax",
      expires: new Date(token.expiry),
      path: "/",
    });
    return res
      .status(200)
      .json({ message: "user logged in Successfully.", data: token._id });
  } catch (err) {
    next(err);
  }
});

router.post("/signup", async (req, res, next) => {
  const { fullname, email, password } = req.body;

  try {
    const newUser = {
      fullname, //allowing all type of names inc. falsy input
      email,
      password, //rn we're not using an hashing for password
    };

    const result = await User.insertOne(newUser);
    return res
      .status(201)
      .json({
        success: true,
        message: "user signed up successfully.",
      });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", (req, res) => {
  return res
    .setHeader(
      "Set-Cookie",
      `uid=; expires=${new Date(new Date() - 3600 * 1000).toUTCString()}`
    )
    .status(302)
    .json({ success: true, message: "user logged out Successfully." });
});

export default router;
