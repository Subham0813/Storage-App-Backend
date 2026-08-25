/**
 * Format a date consistently across servers.
 * Accepts a Date object, epoch seconds, or epoch milliseconds.
 */
export const formatDate = (date) => {
  const d =
    typeof date === "number"
      ? date < 1e12
        ? new Date(date * 1000) // epoch seconds
        : new Date(date) // epoch ms
      : date instanceof Date
        ? date
        : new Date(date);

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(d);
};
