import path from "path";

export const MAX_DEVICE_COUNT = 2;
export const EMAIL_REGEX = /^[\w.%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}$/;
export const SUPER_ROLES = ["ADMIN", "SUPER_ADMIN"];
export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT || "./uploads");
export const TEMP_ROOT = path.resolve(process.env.TEMP_ROOT || "./uploads/temp");
export const TIME = {
  ONE_MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  FIVE_SECONDS: 5 * 1000,
  TEN_MINUTES: 10 * 60 * 1000,
  FIFTEEN_MINUTES: 15 * 60 * 1000,
  TWO_HOURS: 2 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  FIFTEEN_DAYS_IN_SECONDS: 15 * 24 * 3600 * 1000,
};

export const CHUNK_SIZE = {
  GUEST: 5 * 1024 * 1024,
  USER: 5 * 1024 * 1024,
  ADMIN: 8 * 1024 * 1024,
  SUPER_ADMIN: 8 * 1024 * 1024,
};
