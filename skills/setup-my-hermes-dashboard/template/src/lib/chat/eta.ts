/**
 * The wait-time estimate of a Hermes run (« ⏱️ ~3 min »). Hermes writes `⏱️ Estimate: ~N min` as the first line of
 * any long job and `⏱️ ~N min left` at each step (`RICH_HINT`): `parseEta` reads the latest one from
 * the streamed text, the server keeps it on the run (`chat_runs.eta_seconds` / `eta_at`), and the page counts down.
 * Without one, the person's usual answer time stands in (`estimated: true`).
 */

/** An estimate: `seconds` left as of `at` (ms). `estimated`: no word from Hermes, the usual duration of this person's answers since the run started. */
export type Eta = { seconds: number; at: number; estimated?: boolean };

/** A line that carries an estimate: the stopwatch, « Estimate », « left » / « remaining » (or the French « Plus que »). */
const MARKER = /⏱|estimat|\bleft\b|remaining|plus que/i;

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
/** « ~3 min », « 2-3 min » / « 2 to 3 min » (upper bound), « 1,5 h », « 45 s », « 1 h 30 ». */
const AMOUNT = new RegExp(String.raw`${NUM}(?:\s*(?:-|–|—|to|à)\s*${NUM})?\s*(seconds?|secondes?|secs?|s|minutes?|mins?|mn|hours?|heures?|hrs?|h)(?![a-zà-ÿ])`, "i");
/** The minutes of « 1 h 30 » / « 1 h 30 min ». */
const AFTER_HOURS = /^\s*(\d{1,2})(?!\d)(?!\s*(?:seconds?|secondes?|secs?|s|hours?|heures?|h)(?![a-zà-ÿ]))/i;

const number = (value: string) => Number(value.replace(",", "."));

function lineSeconds(line: string): number | null {
  const match = AMOUNT.exec(line);
  if (!match) return null;
  const value = number(match[2] ?? match[1]!);
  const unit = match[3]!.toLowerCase();
  if (!Number.isFinite(value)) return null;
  if (unit.startsWith("h")) {
    const minutes = AFTER_HOURS.exec(line.slice(match.index + match[0].length));
    return Math.round(value * 3600 + (minutes ? Number(minutes[1]) * 60 : 0));
  }
  if (unit.startsWith("m")) return Math.round(value * 60);
  return Math.round(value);
}

/** The last estimate in the text, in seconds (the first amount of the last line that has one); null when there is none. */
export function parseEta(text: string): number | null {
  if (!text || !MARKER.test(text)) return null;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!MARKER.test(line)) continue;
    const seconds = lineSeconds(line);
    if (seconds !== null) return seconds;
  }
  return null;
}

/**
 * Follows a run's text chunk by chunk (the server relay): returns the new estimate when Hermes writes a different one,
 * else null. Only the line in progress and the new text are read again, so a long answer stays cheap.
 */
export function etaTracker(initial: number | null = null) {
  let text = "";
  let last = initial;
  return (chunk: string): number | null => {
    if (!chunk) return null;
    const from = text.lastIndexOf("\n", text.length - 1);
    text += chunk;
    const seconds = parseEta(text.slice(from === -1 ? 0 : from));
    if (seconds === null || seconds === last) return null;
    last = seconds;
    return seconds;
  };
}

/** Seconds left now (may be ≤ 0 once overdue). */
export const secondsLeft = (eta: Pick<Eta, "seconds" | "at">, now: number) => eta.seconds - (now - eta.at) / 1000;

/** « ~3 min », « ~40 s », « ~1 h 20 », or null once overdue (then « Almost done… »). Never 0 or negative. */
export function remainingShort(seconds: number, setAt: number, now: number): string | null {
  const left = secondsLeft({ seconds, at: setAt }, now);
  if (left <= 0) return null;
  if (left < 55) return `~${Math.max(5, Math.ceil(left / 5) * 5)} s`;
  const minutes = Math.max(1, Math.ceil(left / 60));
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `~${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}

export const SOON = "Almost done…";

/** « ~3 min left », « ~40 s left », then « Almost done… » once the time is up. */
export function remainingLabel(etaSeconds: number, setAt: number, now: number): string {
  const short = remainingShort(etaSeconds, setAt, now);
  return short ? `${short} left` : SOON;
}

/** The thread's pill: Hermes's estimate, or the usual duration flagged as such. */
export function etaLabel(eta: Eta, now: number): string {
  const short = remainingShort(eta.seconds, eta.at, now);
  if (!short) return SOON;
  return eta.estimated ? `${short} (usual time)` : `${short} left`;
}

/** Usual answer time: median of the durations (ms) given, clamped to 20 s..15 min, in seconds; null without any. */
export function typicalSeconds(durationsMs: number[]): number | null {
  const list = durationsMs.filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  const median = list.length % 2 ? list[mid]! : (list[mid - 1]! + list[mid]!) / 2;
  return Math.round(Math.min(900, Math.max(20, median / 1000)));
}

/**
 * What the live turn shows: Hermes's estimate read from the text so far (`parsed`), dated when the page first saw it
 * (`seenAt`) unless the server already has the same value with its real time; else the stored one (Hermes's or usual).
 */
export function pickEta(parsed: { seconds: number; seenAt: number } | null, stored: Eta | null | undefined): Eta | null {
  if (parsed) {
    if (stored && !stored.estimated && stored.seconds === parsed.seconds) return stored;
    return { seconds: parsed.seconds, at: parsed.seenAt };
  }
  return stored ?? null;
}

/** The text without Hermes's stopwatch lines (« ⏱️ Estimate: ~3 min », « ⏱️ ~1 min left »): the pill already shows them. */
export function withoutEta(text: string): string {
  if (!text.includes("⏱")) return text;
  return text
    .split("\n")
    .filter((line) => !/^\s*(?:[*_>-]\s*)*⏱/.test(line))
    .join("\n")
    .replace(/^\s*\n+/, "")
    .replace(/\n{3,}/g, "\n\n");
}
