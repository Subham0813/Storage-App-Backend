import mongoose from "mongoose";

const connectMongoose = async (uri = process.env.MONGO_URI) => {
  try {
    if (mongoose.connection.readyState >= 1) {
      return mongoose.connection;
    }
    const mongooseConnect = await mongoose.connect(uri);
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
