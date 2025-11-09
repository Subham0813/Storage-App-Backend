import multer from "multer";
const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(
        null,
        "./RootDirectory"
      );
    },
    filename: (req, file, cb) => {
      const id = crypto.randomUUID();
      const name = `${id}.${file.mimetype.split("/").pop()}`;
      file.id = id
      cb(null, name);
    },
  });
  
  const upload = multer({ storage: diskStorage });

export default upload;