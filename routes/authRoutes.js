import { Router } from "express";
import { writeFile } from "fs/promises";
import { createToken } from "../utils/createAndValidateToken.js";

let { default: bin } = await import("../DBs/bins.db.json", {
  with: { type: "json" },
});
let { default: directoriesDb } = await import("../DBs/directories.db.json", {
  with: { type: "json" },
});
let { default: userDb } = await import("../DBs/users.db.json", {
  with: { type: "json" },
});

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "All the fields are required!" });

  const user = userDb.find((item) => item.email === email.toLowerCase());
  if (!user || user.password !== password)
    return res.status(400).json({ message: "Invalid Cradentials!!" });

  const existingDb = directoriesDb.find((item) => item.id === user.id);
  const existingBin = bin.find((item) => item.id === user.id);

  if (!existingDb) {
    const newUserDb = {
      id: user.id,
      content: [
        {
          id: null,
          name: "root",
          directories: [],
          files: [],
        },
      ],
    };

    directoriesDb.push(newUserDb);
  }
  if (!existingBin) {
    const newUserBin = {
      id: user.id,
      content: [
        {
          id: null,
          name: "bin",
          directories: [],
          files: [],
        },
      ],
    };

    bin.push(newUserBin);
  }

  try {
    const token = await createToken(user.id);

    if (!existingDb)
      await writeFile(
        "./DBs/directories.db.json",
        JSON.stringify(directoriesDb)
      );
    await writeFile("./DBs/bins.db.json", JSON.stringify(bin));

    return res
      .setHeader("Set-Cookie", [
        `uid=${token.id}; HttpOnly; Expires=${new Date(
          token.expiry
        ).toUTCString()}`,
      ])
      .status(302)
      .json("User logged in Successfully.");
  } catch (error) {
    console.log(error);
    return res.status(500).json("Somthing went wrong!");
  }
});

router.post("/signup", async (req, res) => {
  // console.log(req.headers);
  const { firstname, lastname, email, password } = req.body;
  if (!firstname || !lastname || !email || !password)
    return res.status(400).json({ message: "All the fields are required!" });

  const userExists = userDb.find((item) => item.email === email);
  if (userExists) return res.status(400).json("User already exists!");

  const newUser = {
    id: crypto.randomUUID(),
    firstname,
    lastname,
    email: email.toLowerCase(),
    password,
  };

  userDb.push(newUser);

  try {
    await writeFile("./DBs/users.db.json", JSON.stringify(userDb));
    return res.status(302).json("Sign up successfull.");
    // return res.status(302).redirect("/login"); // .redirect(...)  === .setHeader('Location', 'http://localhost:4000/login').end()
  } catch (error) {
    console.log(error.message);
    return res.status(500).json("Somthing went wrong!");
  }
});

router.post("/logout", (req, res) => {
  return res
    .setHeader(
      "Set-Cookie",
      `uid=; expires=${new Date(new Date() - 3600 * 1000).toUTCString()}`
    )
    .status(200)
    .json("User logged out Successfully.");
});

export default router;
