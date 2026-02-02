import mongoose from "mongoose";

const connectMongoose = async () => {
  try {
    const mongooseConnect = await mongoose.connect(
      "mongodb://subham:y4huMrARR3J2kXCR@localhost:27017/StorageApp?authSource=admin&replicaSet=rs0"
    );
    console.log("Database connected..");
    return mongooseConnect;
  } catch (err) {
    console.log("Database connection failed!");
    throw err
  }
};

process.once("SIGINT", async () => {
  await mongoose.disconnect();
  console.log("Database disconnected!");
  process.exit(1);
});

export default connectMongoose;
