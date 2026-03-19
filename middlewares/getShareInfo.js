import { SUPER_ROLES } from "../misc/constants.js";
import { Directory } from "../models/directory.model.js";
import { UserFile } from "../models/user_file.model.js";
import { badRequest, forbidden, hasAccess, notFound } from "../utils/helper.js";

export const getShareInfo = (path) => {
  return async (req, res, next) => {
    try {
      const Model =
        path === "file" ? UserFile : path === "dir" ? Directory : null;
      if (!Model) next(err);

      const { _id: userId, email } = req.user;
      const item = await Model.findOne({
        _id: req.params.id,
        isDeleted: false,
      })
        .select(`${path}name userId publicRole sharedWith sharedAt shareToken`)
        .lean();
      if (!item) return notFound(res, "Item not found.");

      const isOwner = item.userId.toString() === userId.toString();
      const isShared = hasAccess(item, ["VIEWER", "EDITOR"], email);

      if (!item.sharedAt)
        return res.status(200).json({
          success: true,
          message: "Item is not shared.",
          data: { shareInfo: null },
        });

      if (!isShared && !isOwner && !SUPER_ROLES.includes(req.user?.role))
        return forbidden(res);

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
