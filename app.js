import express from "express";
import serveFavicon from "serve-favicon";
import cors from "cors";

import fileRoutes from "./routes/fileRoutes.js";
import directoryRoutes from "./routes/directoryRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { validateToken } from "./services/auth.js";

const app = express();
const port = 4000;

app.use(serveFavicon(import.meta.dirname + "/public/favicon.ico"));

app.use(cors());
app.use(express.json());

app.use("/", authRoutes);
app.use((req, res, next) => {
  //parsing cookies
  const cookies = {};
  if (!req.headers || !req.headers.cookie)
    return res.status(400).json("Cookies not found! Relogin with credentials.");

  req.headers.cookie.split("; ").forEach((item) => {
    const [key, val] = item.split("=");
    cookies[key] = val;
  });

  req.cookies = cookies;
  next();
});
app.use("/files", validateToken("uid"), fileRoutes);
app.use("/dirs", validateToken("uid"), directoryRoutes);

app.listen(port, () => {
  console.log("server started at port :", port);
});
