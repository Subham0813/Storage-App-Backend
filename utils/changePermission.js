import { Directory } from "../models/directory.model";

export const recursiveChangePermission = async (dir, sharedEmails, visited) => {
  try {
    if (visited.has(dir._id.toString())) return;
    visited.add(dir._id.toString());

    // 1. chnage files
    await UserFile.findOneAndUpdate(
      { parentId: dir._id, isDeleted: false },
      {
        $set: {
          $push: { sharedWith: { $each: sharedEmails } },
          updatedAt: new Date(),
        },
      },
    );

    const children = await Directory.find({
      parentId: dir._id,
      isDeleted: false,
    });

    // 2. depth-first chnage permission on child
    for (const child of children) {
      await recursiveChangePermission(child, visited);

      await Directory.findOneAndUpdate(
        { _id: child._id },
        {
          $set: {
            $push: { sharedWith: { $each: sharedEmails } },
            updatedAt: new Date(),
          },
        },
      );
    }
  } catch (err) {
    throw err;
  }
};
