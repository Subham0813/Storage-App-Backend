import mongoose from "mongoose";
import { SUPER_ROLES } from "../misc/constants.js";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { getErrorObject, hasAccess } from "../utils/helper.js";

export const getShareInfo = (path) => {
  return async (req, res, next) => {
    try {
      const Model =
        path === "file" ? UserFile : path === "dir" ? Directory : null;
      if (!Model) next(err);

      if (!mongoose.isValidObjectId(req.params.id))
        return next(getErrorObject("Invalid id."));

      if (req.isTokenAuthorized && !req.user?._id) {
        return next(getErrorObject("You do not have this permission.", 403));
      }

      const { _id: userId, email } = req.user;
      const item = await Model.findOne({
        _id: req.params.id,
        isDeleted: false,
      })
        .select(`${path}name userId publicRole sharedWith sharedAt shareToken`)
        .lean();
      if (!item) return next(getErrorObject("Item not found.", 404));

      const isOwner = item.userId.toString() === userId.toString();
      const isShared = hasAccess(item, ["view", "edit"], email);

      if (!item.sharedAt)
        return next(getErrorObject("Item is not shared.", 204));

      if (!isShared && !isOwner && !SUPER_ROLES.includes(req.user?.role))
        return next(getErrorObject("You don't have this permission", 403));

      return res.status(200).json({
        success: true,
        message: "Sharing details found.",
        data: { shareInfo: item },
      });
    } catch (err) {
      next(err);
    }
  };
};
