import { ObjectId } from "mongodb";
import { connectDb } from "../configs/db.js";

const createToken = async (userId) => {
  try {
    const db = await connectDb();
    await db.collection("tokens").deleteOne({ userId: userId });

    const expiry = new Date().getTime() + 24 * 3600 * 1000;
    const payload = {
      secrete: crypto.randomUUID(),
      expiry,
      userId,
      exp_time: new Date(expiry).toLocaleString(),
    };

    const { insertedId } = await db.collection("tokens").insertOne(payload);
    payload._id = insertedId;
    return payload;
  } catch (error) {
    console.log("create token error", error);
    return null;
  }
};

export { createToken };
