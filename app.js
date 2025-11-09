import express from "express";
import serveFavicon from "serve-favicon";
import cors from "cors";

import apiRoutes from "./routes/apiRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import { validateToken } from "./services/tokenHandler.js";

const app = express();
const port = 4000;

app.use(serveFavicon(import.meta.dirname + "/public/favicon.ico"));

app.use(cors());
app.use(express.json());

app.use("/", authRoutes);
app.use("/api", validateToken, apiRoutes);

app.listen(port, () => {
  console.log("server started at port :", port);
});
