import { createClient } from "redis";

export const redisClient = await createClient({ url: process.env.REDIS_URL })
  .on("connect", (err) => console.info("RedisClient Connected."))
  .on("error", (err) => console.error("RedisClient Error", err))
  .connect();

process.once("SIGINT", async () => {
  await redisClient.close();
  console.info("RedisClient Disconnected.");
  process.exit(1);
});
