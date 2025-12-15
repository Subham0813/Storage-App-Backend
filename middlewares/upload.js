import multer from "multer";
import path from "path";

const diskStorage = multer.diskStorage({
  
  destination: (req, file, cb) => {
    cb(null, "./uploads");
  },
  
  filename: (req, file, cb) => {
    cb(null, crypto.randomUUID());
  },
});

const upload = multer({ storage: diskStorage });

export default upload;
