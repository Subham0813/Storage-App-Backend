/**
 * Safely coerce a value to a Date or null.
 * Returns null for nullish values and any date before 2026 (epoch, 0, etc.).
 */
export const safeDate = (d) => {
  if (!d) return null;
  const date =
    typeof d === "number"
      ? d < 1e12
        ? new Date(d * 1000)
        : new Date(d)
      : d instanceof Date
        ? d
        : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear() >= 2026 ? date : null;
};

/**
 * Format a date consistently across servers.
 * Accepts a Date object, epoch seconds, or epoch milliseconds.
 * Returns empty string for null/epoch/before-2026 dates.
 */
export const formatDate = (date) => {
  const d = safeDate(date);
  if (!d) return "";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(d);
};
