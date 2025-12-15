const INLINE_MIME = new Set([
  // Images
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/gif",
  "image/x-icon",

  // Audio
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/aac",

  // Video (browser-playable only)
  "video/mp4",
  "video/webm",
  "video/ogg",

  // Documents
  "application/pdf",

  // Plain text ONLY
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
]);

const INLINE_MIME_AUDIO_VIDEO_EXT = new Set([
  // Audio
  "mpeg",
  "ogg",
  "wav",
  "webm",
  "aac",

  // Video (browser-playable only)
  "mp4",
  "webm",
  "ogg",
]);

const OFFICE_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

export { INLINE_MIME, INLINE_MIME_AUDIO_VIDEO_EXT, OFFICE_MIME };
