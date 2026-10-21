const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12 min ago", "3 h ago", "2 d ago", then the date. `now` comes from the server so SSR and hydration agree. */
export function ago(ts: number | null, now: number): string {
  if (!ts) return "never";
  const diff = now - ts;
  if (diff < 0) return until(ts, now);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} d ago`;
  return shortDate(ts);
}

/** "in 5 min", "in 3 h", "in 2 d". */
export function until(ts: number | null, now: number): string {
  if (!ts) return "not planned";
  const diff = ts - now;
  if (diff <= 0) return "due now";
  if (diff < HOUR) return `in ${Math.max(1, Math.round(diff / MINUTE))} min`;
  if (diff < DAY) return `in ${Math.round(diff / HOUR)} h`;
  return `in ${Math.round(diff / DAY)} d`;
}

export const shortDate = (ts: number) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const dateTime = (ts: number) =>
  new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const count = (value: number) => new Intl.NumberFormat("en-US").format(value);
