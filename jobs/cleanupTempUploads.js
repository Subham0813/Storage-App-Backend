import { stat ,readdir} from "fs/promises";
import path from "path";
import { TIME } from "../misc/constants.js";

const TEMP_ROOT = path.resolve(process.cwd(), "uploads/temp");
const MAX_AGE_MS = TIME.TWO_HOURS;

export async function cleanupTempUploads() {
  console.log("....Running cleanupTempUploads....\n")
  const entries = await readdir(TEMP_ROOT, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = path.join(TEMP_ROOT, entry.name);
    const stats = await stat(dirPath);

    const age = Date.now() - stats.mtimeMs;

    if (age > MAX_AGE_MS) {
      await fs.rm(dirPath, { recursive: true, force: true });
      console.log("🧹 Cleaned temp upload:", entry.name,"\n");
    }
  }
  console.log("....Exiting from cleanupTempUploads....\n")
}

// await cleanupTempUploads()
// process.exit(1)