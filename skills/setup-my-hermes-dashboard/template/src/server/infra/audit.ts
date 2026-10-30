import path from "node:path";
import { eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { infraState } from "@/server/db/schema";
import { toMs, type Hermes, type Json } from "@/server/hermes";

import type { AuditAction, AuditJob, AuditReport, AuditSection, Priority, Verdict } from "./model";
import { AUDIT_PROMPT, auditFix } from "./prompts";
import type { System } from "./system";

/** The Hermes cron Infra creates and reads. Renaming it in Hermes makes the page offer to create a new one. */
export const AUDIT_NAME = "infra-audit";
export const AUDIT_SCHEDULE = "0 7 * * *";
const SEEDED = "audit-seeded";
const MAX_REPORT_BYTES = 200_000;

// ---------- Reading a report ----------

/** A Hermes run file holds the job header, the prompt, then the answer after the last "## Response". */
export function answerOf(file: string): string {
  const at = file.lastIndexOf("## Response");
  return (at === -1 ? file : file.slice(at + "## Response".length)).trim();
}

/** `2026-10-30_07-00-12.md` → that time on the server's clock. */
export function timeOfReport(name: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/.exec(name);
  return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!).getTime() : null;
}

const plain = (line: string) =>
  line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/\*\*|__|`/g, "")
    .trim();

const VERDICTS: Record<string, Verdict> = { ok: "ok", attention: "attention", urgent: "urgent", urgence: "urgent" };

/**
 * Reads the format AUDIT_PROMPT asks for, and stays useful when the agent drifts: any "##" heading becomes a section,
 * a missing verdict is "unknown", and the raw answer is always kept.
 */
export function parseReport(id: string, file: string): AuditReport {
  const raw = answerOf(file);
  const verdictWord = /^[\s*_#>-]*verdict[\s*_]*[:：][\s*_]*([a-zé]+)/im.exec(raw)?.[1]?.toLowerCase();
  const summary = /^[\s*_>-]*summary[\s*_]*[:：][\s*_]*(.+)$/im.exec(raw)?.[1]?.replace(/\*\*/g, "").trim() ?? null;
  const sections: AuditSection[] = [];
  const actions: AuditAction[] = [];
  for (const block of raw.split(/^##\s+/m).slice(1)) {
    const [heading = "", ...rest] = block.split("\n");
    const title = heading.replace(/[#*]/g, "").trim();
    const lines = rest.filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)).map(plain).filter(Boolean);
    if (/^actions?\b/i.test(title)) {
      for (const line of lines) {
        if (/^(none|nothing|rien|aucune?)\b/i.test(line)) continue;
        const priority = (/\bP([0-2])\b/i.exec(line)?.[0]?.toUpperCase() ?? "P2") as Priority;
        const text = line.replace(/^\s*\[?P[0-2]\]?\s*[:—–-]?\s*/i, "").trim();
        if (text) actions.push({ priority, text, fix: auditFix(priority, text) });
      }
    } else if (title) {
      sections.push({ title, lines });
    }
  }
  actions.sort((a, b) => a.priority.localeCompare(b.priority));
  return { id, at: timeOfReport(id) ?? 0, verdict: (verdictWord && VERDICTS[verdictWord]) || "unknown", summary, sections, actions, raw };
}

// ---------- The cron ----------

function toJob(job: Json): AuditJob {
  const schedule = (job.schedule ?? {}) as Json;
  const display = typeof job.schedule === "string" ? job.schedule : String(schedule.display ?? schedule.expr ?? schedule.value ?? AUDIT_SCHEDULE);
  return {
    id: String(job.id),
    name: String(job.name ?? ""),
    enabled: job.enabled !== false && job.state !== "paused",
    schedule: display,
    deliver: String(job.deliver ?? "local"),
    nextRunAt: toMs(job.next_run_at),
    lastRunAt: toMs(job.last_run_at),
    lastStatus: typeof job.last_status === "string" ? job.last_status : null,
    lastError: typeof job.last_error === "string" ? job.last_error : null,
  };
}

/** The daily audit: a Hermes cron that looks at the server every morning and writes a report the page reads. */
export class InfraAudit {
  constructor(
    private readonly db: Db,
    private readonly system: System,
    private readonly hermes: Pick<Hermes, "api" | "send">,
    private readonly hermesHome: string,
  ) {}

  async job(): Promise<AuditJob | null> {
    const jobs = await this.hermes.api<Json[]>("/api/cron/jobs");
    const job = Array.isArray(jobs) ? jobs.find((j) => j.name === AUDIT_NAME) : undefined;
    return job ? toJob(job) : null;
  }

  /** Where the report goes besides the page: the first chat with a home channel, else nowhere (saved only). */
  private async deliverTo(): Promise<string> {
    const answer = await this.hermes.api<{ targets?: Json[] }>("/api/cron/delivery-targets").catch(() => null);
    const chat = answer?.targets?.find((t) => t.id !== "local" && t.home_target_set === true && !String(t.id).includes(":"));
    return chat ? String(chat.id) : "local";
  }

  /** Creates the cron, or turns it back on. Safe to call again. */
  async enable(): Promise<AuditJob> {
    const existing = await this.job();
    if (existing?.enabled) return existing;
    if (existing) await this.hermes.send("POST", `/api/cron/jobs/${encodeURIComponent(existing.id)}/resume`);
    else await this.hermes.send("POST", "/api/cron/jobs", { name: AUDIT_NAME, schedule: AUDIT_SCHEDULE, prompt: AUDIT_PROMPT, deliver: await this.deliverTo() });
    this.markSeeded();
    const job = await this.job();
    if (!job) throw new Error("Hermes did not keep the audit cron");
    return job;
  }

  async runNow(): Promise<void> {
    const job = (await this.job()) ?? (await this.enable());
    await this.hermes.send("POST", `/api/cron/jobs/${encodeURIComponent(job.id)}/trigger`);
  }

  /** The newest reports first. */
  async reports(jobId: string, limit = 14): Promise<AuditReport[]> {
    const dir = path.join(this.hermesHome, "cron", "output", path.basename(jobId));
    const names = (await this.system.list(dir)).filter((name) => name.endsWith(".md")).sort().reverse().slice(0, limit);
    const files = await Promise.all(names.map(async (name) => [name, await this.system.read(path.join(dir, name))] as const));
    return files.filter(([, text]) => text && text.length <= MAX_REPORT_BYTES).map(([name, text]) => parseReport(name, text!));
  }

  private markSeeded() {
    this.db.insert(infraState).values({ key: SEEDED, value: String(this.system.now()) }).onConflictDoNothing().run();
  }

  /**
   * Turns the audit on once, the first time the dashboard runs its checks. If the owner deletes the cron later, it
   * stays deleted: the page then offers to turn it back on.
   */
  async seed(): Promise<void> {
    if (this.db.select().from(infraState).where(eq(infraState.key, SEEDED)).get()) return;
    await this.enable();
    this.markSeeded();
  }
}
