import { ObjectId } from "mongodb";

const validateParent = async (req, res, next) => {
  try {
    const db = req.db;
    const dirId = req.params.dirId;
    const userId = req.user._id;

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
              name: 1,
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
  } catch (error) {
    console.log(error);
    return res.status(500).json("Somthing went wrong @validation!!");
  }
};

export { validateParent };
