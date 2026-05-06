import mongoose from "mongoose";

const connectMongoose = async () => {
  try {
    const mongooseConnect = await mongoose.connect(process.env.MONGO_URI);
    console.info("Database Connected.");
    return mongooseConnect;
  } catch (err) {
    console.info("Database Connection Failed.");
    throw err;
  }
};

process.once("SIGINT", async () => {
  await mongoose.disconnect();
  console.info("Database Disconnected!");
  process.exit(1);
});

export default connectMongoose;
