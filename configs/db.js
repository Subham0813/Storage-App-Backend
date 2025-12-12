import { MongoClient } from "mongodb";

const client = new MongoClient("mongodb://127.0.0.1:27017/StorageApp");

const connectDb = async () => {
  await client.connect();
  const db = client.db();
  console.log(`Database ${db.databaseName} connected.`);
  return db;
};

process.once("SIGINT", async () => {
  await client.close();
  console.log("Database disconnected!");
  process.exit(1);
});

export { connectDb };
