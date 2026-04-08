import { createClient } from "redis";

export const redisClient = await createClient({ url: "redis://127.0.0.1:6379" })
  .on("connect", (err) => console.info("RedisClient Connected."))
  .on("error", (err) => console.info("RedisClient Error", err))
  .connect();

process.once("SIGINT", async () => {
  await redisClient.close();
  console.info("RedisClient Disconnected.");
  process.exit(1);
});
