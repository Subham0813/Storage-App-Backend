import { Router } from "express";
import { createToken } from "../utils/createAndValidateToken.js";
import { Db } from "mongodb";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const db = req.db;

  if (!email || !password)
    return res.status(400).json({ message: "All the fields are required!" });

  const user = await db
    .collection("users")
    .findOne({ email: email.toLowerCase(), password: password });

  if (!user)
    return res.status(404).json({ message: "Invalid Cradentials!!" });

  try {
    const token = await createToken(user._id);
    res.cookie("uid", token.secrete, {
      httpOnly: true,
      sameSite: "lax",
      expires: new Date(token.expiry),
      path: "/",
    });
    return res
      .status(200)
      .json({ message: "User logged in Successfully.", data: token._id});
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ message: "Somthing went wrong!", data: null });
  }
});

router.post("/signup", async (req, res) => {
  const db = req.db;
  const { firstname, lastname, email, password } = req.body;
  if (!firstname || !lastname || !email || !password)
    return res.status(400).json({ message: "All the fields are required!" });

  try {
    const user = await db
      .collection("users")
      .findOne({ email: email.toLowerCase() });
    if (user) return res.status(400).json("User already exists!");
    
    const newUser = {
      firstname,
      lastname,
      email: email.toLowerCase(),
      password, //rn we're not using an hashing for password
    };
    const { insertedId } = await db.collection("users").insertOne(newUser);
    return res
      .status(302)
      .json({ message: "Sign up successfull", data: insertedId });
    // return res.status(302).redirect("/login"); // .redirect(...)  === .setHeader('Location', 'http://localhost:4000/login').end()
  } catch (error) {
    console.log(error.message);
    return res
      .status(500)
      .json({ message: "Somthing went wrong!", data: null });
  }
});

router.post("/logout", (req, res) => {
  return res
    .setHeader(
      "Set-Cookie",
      `uid=; expires=${new Date(new Date() - 3600 * 1000).toUTCString()}`
    )
    .status(200)
    .json({ message: "User logged out Successfully.", data: null });
});

export default router;
