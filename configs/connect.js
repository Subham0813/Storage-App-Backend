import mongoose from "mongoose";

try {
  await mongoose.connect("mongodb://127.0.0.1:27017/StorageApp");
  console.log("Database connected..");
} catch (err) {
  console.log("Database connection failed!");
  console.log(err);
}

process.once("SIGINT", async () => {
  await mongoose.disconnect();
  console.log("Database disconnected!");
  process.exit(1);
});
