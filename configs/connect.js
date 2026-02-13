import mongoose from "mongoose";

const connectMongoose = async () => {
  try {
    const mongooseConnect = await mongoose.connect(process.env.MONGO_URI);
    console.log("Database connected..");
    return mongooseConnect;
  } catch (err) {
    console.log("Database connection failed!");
    throw err;
  }
};

process.once("SIGINT", async () => {
  await mongoose.disconnect();
  console.log("Database disconnected!");
  process.exit(1);
});

export default connectMongoose;
