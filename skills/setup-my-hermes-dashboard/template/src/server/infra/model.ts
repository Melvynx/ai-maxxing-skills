/** Shapes shared by the Infra server code and its pages. Types only: the pages import nothing that runs on the server. */

export type Tone = "good" | "warn" | "bad" | "idle";

export type Category = "hermes" | "services" | "server" | "security";

export const CATEGORIES: { id: Category; title: string; hint: string }[] = [
  { id: "hermes", title: "Hermes", hint: "The agent, its chat, its crons and its version" },
  { id: "services", title: "Services", hint: "The programs that keep the dashboard and Hermes online" },
  { id: "server", title: "Server", hint: "Disk, memory, load, restarts and system updates" },
  { id: "security", title: "Security", hint: "Who can log in and what is open to the internet" },
];

/** A task Hermes can take on: shown in a sheet where an admin can edit it before sending it to the Hermes board. */
export interface FixDraft {
  /** Same problem, same key: the dashboard refuses a second open task for it. */
  key: string;
  title: string;
  prompt: string;
}

export interface Check {
  /** `<category>.<name>`, e.g. `server.disk`. */
  id: string;
  category: Category;
  title: string;
  tone: Tone;
  /** One line: "41% used, 52 GB free". */
  summary: string;
  /** More lines when something is off (names, numbers, the command to run). */
  detail?: string[];
  /** What the dashboard already did on its own this run, e.g. "Restarted caddy". */
  autoFixed?: string;
  /** Only on a check that needs a hand. */
  fix?: FixDraft;
}

export interface HealthRun {
  at: number;
  tone: Tone;
  checks: Check[];
}

/** One past run, for the history strip: when, and how it went. */
export interface HealthMark {
  at: number;
  tone: Tone;
  bad: number;
  warn: number;
}

export type Verdict = "ok" | "attention" | "urgent" | "unknown";

export type Priority = "P0" | "P1" | "P2";

export interface AuditAction {
  priority: Priority;
  text: string;
  fix: FixDraft;
}

export interface AuditSection {
  title: string;
  lines: string[];
}

export interface AuditReport {
  /** Name of the report file, `YYYY-MM-DD_HH-MM-SS.md`. */
  id: string;
  at: number;
  verdict: Verdict;
  summary: string | null;
  sections: AuditSection[];
  actions: AuditAction[];
  /** The whole answer, for the "raw report" view when the format was not followed. */
  raw: string;
}

export interface AuditJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  deliver: string;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
}

export type FixStatus = "queued" | "running" | "blocked" | "done" | "failed";

export interface Fix {
  id: string;
  source: "health" | "audit";
  key: string;
  title: string;
  taskId: string | null;
  status: FixStatus;
  /** Hermes's last word on the task (its summary, or why it failed). */
  note: string | null;
  actor: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Fixes that still need Hermes or someone. */
export const isOpen = (fix: Pick<Fix, "status">) => fix.status === "queued" || fix.status === "running" || fix.status === "blocked";

const ORDER: Tone[] = ["idle", "good", "warn", "bad"];

/** The worst tone of a list ("idle" checks never make a run look better or worse than the others). */
export function worst(tones: Tone[]): Tone {
  const real = tones.filter((tone) => tone !== "idle");
  if (!real.length) return "idle";
  return real.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a));
}
