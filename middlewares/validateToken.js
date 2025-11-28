import { ObjectId } from "mongodb";

const validateToken = async (req, res, next) => {
  const db = req.db;
  const uid = req.cookies.uid;
  
  if (!uid)
    return res
      .status(400)
      .json(
        "validate token failed!! Cookies not found! Relogin with credentials."
      );

  try {
    const payload = await db.collection("tokens").findOne({ secrete: uid });

    if (!payload)
      return res.status(400).json("Invalid Cookies! Relogin with credentials.");

    if (payload.expiry - new Date().getTime() > 1) {
      const user = await req.db
        .collection("users")
        .findOne({ _id: new ObjectId(payload.userId) });
      req.user = user;
      next();
    } else {
      await db.collection("tokens").deleteOne({ _id: new ObjectId(uid) });
      return res.status(302).json("Cookies expired! Relogin with credentials.");
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json("Somthing went wrong @validation!!");
  }
};
export { validateToken };
