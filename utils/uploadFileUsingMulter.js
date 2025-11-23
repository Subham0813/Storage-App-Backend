import multer from "multer";
import path from "path";

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./uploads");
  },
  filename: (req, file, cb) => {
    const id = crypto.randomUUID();
    const name = `${id}${path.extname(file.originalname)}`;
    file.id = id;
    cb(null, name);
  },
});

const upload = multer({ storage: diskStorage });

export default upload;