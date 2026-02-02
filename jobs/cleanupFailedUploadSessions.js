import { UploadSession } from "../models/uploadSession.model.js";
import connectMongoose from "../configs/connect.js";

export async function cleanupFailedUploadSessions() {
  try {
    console.log(".....Running cleanupFailedUploadSessions.....\n");
    const mongoose = await connectMongoose();
    console.log(
      `.....${mongoose.connection.db.databaseName} connected for cleanupFailedUploadSessions.....\n`
    );

    const MAX_AGE_MS = new Date(Date.now() - 15 * 60 * 1000);
    const failedSessions = await UploadSession.deleteMany({
      status: "failed",
      createdAt: MAX_AGE_MS,
    });

    console.log(
      ".....Completed cleanupFailedUploadSessions.....\n",
      failedSessions
    );
  } catch (err) {
    console.log(
      ".....Error at cleanupFailedUploadSessions.....\n",
      err.message
    );
  }
}

// await cleanupFailedUploadSessions()
// process.exit(1)