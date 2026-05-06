import path from "path";

export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
export const GITHUB_REDIRECT_URI = process.env.GITHUB_REDIRECT_URI;
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export const GOOGLE_DRIVE_REDIRECT_URI = process.env.GOOGLE_DRIVE_REDIRECT_URI;

export const MAX_DEVICE_COUNT = 2;
export const FILENAME_REGEX = /^[^\\/:\*\?"<>|]+$/;
export const EMAIL_REGEX = /^[\w.%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}$/;
export const SUPER_ROLES = ["admin", "super_admin"];
export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_ROOT);
export const TEMP_ROOT = path.resolve(process.env.TEMP_ROOT);

export const t = {
  _ms: 1000,
  _min: 60,
  _hr: 3600,
  _day: 86400,
};

export const CHUNK = {
  free: 5 * 1024 * 1024,
  lite: 5 * 1024 * 1024,
  plus: 8 * 1024 * 1024,
  pro: 10 * 1024 * 1024,
  super: 15 * 1024 * 1024,
};

export const EXPORT_MAP = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.presentation":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
