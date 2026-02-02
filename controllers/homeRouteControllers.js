import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";

export const getRecentsHandler = async (req, res, next) => {
  const userId = req.user._id;
  const defaultDaysOld = Date.now() - 7 * 24 * 3600 * 1000; //default: 7days old
  let daysOld = defaultDaysOld;

  daysOld =
    req.body.daysOld && req.body.daysOld < defaultDaysOld
      ? req.body.daysOld
      : defaultDaysOld;

  try {
    const directories = await Directory.find(
      {
        userId,
        isDeleted: false,
        updatedAt: { $gte: daysOld },
      },
    ).lean();

    const files = await UserFile.find(
      {
        userId,
        isDeleted: false,
        updatedAt: { $gte: daysOld },
      },
    )
      .populate({ path: "meta", select: "detectedMime size -_id" })
      .lean();

    const flattenedFiles = files.map(({ meta, ...rest }) => ({
      ...rest,
      ...meta,
    }));

    const data = {
      directories,
      files: flattenedFiles,
    };
    return res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const getBinDirectoryHandler = async (req, res, next) => {
  try {
    const directories = await Directory.find(
      { userId: req.user._id, deletedBy: "user" },
    ).lean();

    const files = await UserFile.find(
      { userId: req.user._id, deletedBy: "user" },
    ).lean();

    const flattenedFiles = files.map(({ meta, ...rest }) => ({
      ...rest,
      ...meta,
    }));

    return res.status(200).json({
      success: true,
      data: { directories, files: flattenedFiles },
    });
  } catch (err) {
    next(err);
  }
};

export const handleLogout = async (req, res, next) => {
  try {
    await User.findOneAndUpdate(
      { _id: req.user._id, deviceCount: { $gt: 0 } },
      { $inc: { deviceCount: -1 } },
    );

    await Session.deleteOne({ _id: req.signedCookies.sid });

    return res.status(200).clearCookie("sid").json({
      success: true,
      statusCode: 200,
      message: "Logout Successful.",
    });
  } catch (err) {
    err.customMessage =
      "Logout process failed due to some unavoidable reasons. Try again.";
    next(err);
  }
};

export const handleLogoutAll = async (req, res, next) => {
  try {
    await User.findOneAndUpdate(
      { _id: req.user._id, deviceCount: { $gt: 0 } },
      { $set: { deviceCount: 0 } },
      { select: "-__v", new: true },
    );

    await Session.deleteMany({ userId: user._id });

    return res.status(200).clearCookie("sid").json({
      success: true,
      statusCode: 200,
      message: "Logout Successful from all devices.",
    });
  } catch (err) {
    err.customMessage =
      "Logout from all devices failed due to some unavoidable reasons. Try again.";
    next(err);
  }
};

export const handleDeleteProfile = async (req, res, next) => {
  const userId = req.user._id;

  try {
    //unlink all files
    const files = await UserFile.find({ userId })
      .populate({ path: "meta", select: "hash" })
      .lean();
    for (const file of files) {
      const absolutePath = path.join(path.resolve(UPLOAD_ROOT), file.meta.hash);

      if (!absolutePath.startsWith(path.resolve(UPLOAD_ROOT))) {
        throw new Error("Error occurred during execution!!");
      }

      try {
        await unlink(absolutePath);
        console.log("File deleted from local..");
      } catch (err) {
        if (err.code !== "ENOENT") {
          throw err;
        }
      }
    }

    //delete all user related infos from Db
    const op = await Promise.all([
      Directory.deleteMany({ userId }),
      FileModel.deleteMany({ userId }),
      UserFile.deleteMany({ userId }),
      Session.deleteMany({ userId }),
    ]);

    return res.status(200).clearCookie("sid").json({
      success: true,
      statusCode: 200,
      message: "Account deleted successfully.",
    });
  } catch (err) {
    err.customMessage =
      "Account deletion failed due to some unavoidable reasons. Try again.";
    next(err);
  }
};
