import { ObjectId } from "mongodb";

const validateParent = async (req, res, next) => {
  try {
    const db = req.db;
    const userId = req.user._id;
    const dirId = req.params.dirId;

    if(dirId && !ObjectId.isValid(dirId)){
      return res
        .status(400)
        .json({ message: "Invalid id. Directory Not Found!", data: null });
    }

    const parentDirectory = dirId
      ? await db.collection("directories").findOne(
          {
            _id: new ObjectId(dirId),
            isDeleted: false,
            userId: userId,
          },
          {
            projection: {
              _id: 1,
              ancestors: 1,
            },
          }
        )
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
      const user = await req.db
        .collection("users")
        .findOne({ _id: new ObjectId(payload.userId) });
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
