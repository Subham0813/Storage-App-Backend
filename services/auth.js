import { writeFile } from "fs/promises";

let { default: tokens } = await import("../models/tokens.model.json", {
  with: { type: "json" },
});
const { default: userDb } = await import("../models/userDb.model.json", {
  with: { type: "json" },
});

const createToken = async (userId) => {
  try {
    let token = await validate(userId);

    const expiry = new Date().getTime() + 3600 * 1000;
    if (!token) {
      token = {
        id: crypto.randomUUID(),
        userId,
        expiry,
        exp_time: new Date(expiry).toLocaleTimeString(),
      };
      tokens.push(token);
      await writeFile("./models/tokens.model.json", JSON.stringify(tokens));
    }
    return token;
  } catch (error) {
    console.log("create token error", error);
    return error;
  }
};

const validateToken = (cookieName) => {
  return async (req, res, next) => {
    const uid = req.cookies[cookieName];
    if (!uid)
      return res
        .status(400)
        .json("Cookies not found! Relogin with credentials.");

    const payload = tokens.find((item) => item.id === uid);
    if (!payload)
      return res.status(400).json("Invalid Cookies! Relogin with credentials.");

    const isValidPayload = await validate(payload.userId);
    if (isValidPayload) {
      const user = userDb.find((user) => user.id === isValidPayload.userId);
      req.user = user;
      next();
    } else
      return res.status(302).json("Cookies expired! Relogin with credentials.");
  };
};

const validate = async (userId) => {
  const token = tokens.find((item) => item.userId === userId);
  if (!token) return null;
  return token.expiry - new Date().getTime() > 1
    ? token
    : await removeInvalidToken(userId);
};

const removeInvalidToken = async (userId) => {
  const validTokens = tokens.filter((item) => item.userId !== userId);
  console.log(validTokens);
  tokens = validTokens;
  try {
    await writeFile("./models/tokens.model.json", JSON.stringify(tokens));
    return null;
  } catch (error) {
    return error;
  }
};

export { validateToken, createToken };
