import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { infraFixes } from "@/server/db/schema";

import { isOpen, type Fix, type FixStatus } from "./model";
import type { System } from "./system";

/** Same problem already on the Hermes board: the page asks the admin whether to send it again. */
export class FixExistsError extends Error {
  constructor(readonly fix: Fix) {
    super("This problem already has an open task");
  }
}

const OPEN: FixStatus[] = ["queued", "running", "blocked"];
/** The board is asked again at most this often (each `hermes` call starts Python, about a second). */
const REFRESH_GAP_MS = 30_000;

/** Hermes board statuses → what the page shows. */
export function statusOf(status: unknown): FixStatus {
  switch (status) {
    case "running":
      return "running";
    case "blocked":
    case "review":
      return "blocked";
    case "done":
    case "archived":
      return "done";
    default:
      return "queued";
  }
}

/** The JSON object a `hermes ... --json` command printed, even with a log line before it. */
export function jsonOf(stdout: string): Record<string, unknown> | null {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try {
    return JSON.parse(stdout.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null);

const toFix = (row: typeof infraFixes.$inferSelect): Fix => ({
  id: row.id,
  source: row.source as Fix["source"],
  key: row.key,
  title: row.title,
  taskId: row.taskId,
  status: row.status as FixStatus,
  note: row.note,
  actor: row.actor,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Fix tasks: an admin sends a problem to the Hermes board (`hermes kanban create`), the gateway hands it to the agent,
 * and the page follows it with `hermes kanban show`. One open task per problem key.
 */
export class InfraFixes {
  private lastRefresh = 0;

  constructor(
    private readonly db: Db,
    private readonly system: System,
    private readonly hermesBin: string,
  ) {}

  list(limit = 30): Fix[] {
    return this.db.select().from(infraFixes).orderBy(desc(infraFixes.createdAt)).limit(limit).all().map(toFix);
  }

  async launch(input: { source: Fix["source"]; key: string; title: string; prompt: string; actor: string | null; again?: boolean }): Promise<Fix> {
    const open = this.db
      .select()
      .from(infraFixes)
      .where(and(eq(infraFixes.key, input.key), inArray(infraFixes.status, OPEN)))
      .get();
    if (open && !input.again) throw new FixExistsError(toFix(open));

    const now = this.system.now();
    const id = `fix_${randomBytes(6).toString("hex")}`;
    this.db
      .insert(infraFixes)
      .values({ id, source: input.source, key: input.key, title: input.title, prompt: input.prompt, status: "queued", actor: input.actor, createdAt: now, updatedAt: now })
      .run();

    // The board refuses a second open task with the same idempotency key: "again" gets a new one.
    const idempotency = `infra:${input.key}${input.again ? `:${now}` : ""}`;
    const result = await this.system.run(
      this.hermesBin,
      ["kanban", "create", input.title, "--body-file", "-", "--assignee", "default", "--idempotency-key", idempotency, "--created-by", `dashboard:${input.actor ?? "owner"}`, "--json"],
      { input: input.prompt, timeoutMs: 30_000 },
    );
    const task = jsonOf(result.stdout);
    const taskId = text(task?.id) ?? text((task?.task as Record<string, unknown> | undefined)?.id);
    const update = taskId
      ? { taskId, status: statusOf(task?.status), note: null }
      : { status: "failed" as const, note: text(result.stderr) ?? text(result.stdout) ?? "Hermes did not create the task" };
    this.db.update(infraFixes).set({ ...update, updatedAt: this.system.now() }).where(eq(infraFixes.id, id)).run();
    return toFix(this.db.select().from(infraFixes).where(eq(infraFixes.id, id)).get()!);
  }

  /** Asks the board where the open tasks are. Cheap to call on every page load: it only runs every 30 seconds. */
  async refresh(): Promise<void> {
    const now = this.system.now();
    if (now - this.lastRefresh < REFRESH_GAP_MS) return;
    this.lastRefresh = now;
    const open = this.list(50).filter((fix) => isOpen(fix) && fix.taskId);
    await Promise.all(
      open.slice(0, 8).map(async (fix) => {
        const result = await this.system.run(this.hermesBin, ["kanban", "show", fix.taskId!, "--json"], { timeoutMs: 20_000 });
        const shown = jsonOf(result.stdout);
        const task = (shown?.task ?? shown) as Record<string, unknown> | null;
        if (!task) return;
        const status = statusOf(task.status);
        const note = status === "blocked" && task.status === "review" ? "Waiting for a review on the Hermes board" : (text(shown?.latest_summary) ?? text(task.result) ?? text(task.last_failure_error) ?? fix.note);
        if (status !== fix.status || note !== fix.note) {
          this.db.update(infraFixes).set({ status, note, updatedAt: this.system.now() }).where(eq(infraFixes.id, fix.id)).run();
        }
      }),
    );
  }
}
