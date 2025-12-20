import { ObjectId } from "mongodb";
import User from "../models/user.model.js";
import Directory from "../models/directory.model.js";

const validateParent = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const dirId = req.params.dirId || req.body.dirId;
    console.log(req.body)

    if (dirId && !ObjectId.isValid(dirId)) {
      return res
        .status(400)
        .json({ message: "Invalid id. Directory Not Found!", data: null });
    }

    const parentDirectory = dirId
      ? await Directory.findOne(
          { _id: new ObjectId(dirId), isDeleted: false, userId: userId },
          { _id: 1 }
        ).lean()
      : null;

    if (dirId && !parentDirectory)
      return res
        .status(404)
        .json({ message: "Directory Not Found!", data: null });

    req.parentDir = parentDirectory;
    next();
  } catch (err) {
    next(err);
  }
};

const validateToken = async (req, res, next) => {
  const db = req.db;
  const uid = req.cookies.uid;
  const currTime = new Date().getTime();

  if (!uid)
    return res.status(400).json("Cookies not found! Relogin with credentials.");

  try {
    const payload = await db.collection("tokens").findOne({ secrete: uid });

    if (!payload)
      return res.status(400).json("Invalid Cookies! Relogin with credentials.");

    if (payload.expiry - currTime > 1) {
      const user = await User.findById(payload.userId);
      req.user = user;
      next();
    } else {
      await db.collection("tokens").deleteOne({ _id: new ObjectId(uid) });
      return res.status(302).json("Cookies expired! Relogin with credentials.");
    }
  } catch (err) {
    next(err);
  }
};
export { validateToken, validateParent };
