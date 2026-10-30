import { desc, gte, lt } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { infraRuns } from "@/server/db/schema";
import type { Hermes } from "@/server/hermes";

import { runChecks, type CheckContext } from "./checks";
import { worst, type Check, type HealthMark, type HealthRun, type Tone } from "./model";
import type { System } from "./system";

const DAY = 86_400_000;
const KEEP_MS = 7 * DAY;
/** "Check now" twice in a row gives the same run instead of hitting the machine again. */
const MIN_GAP_MS = 20_000;
const RESTART_GAP_MS = 3_600_000;

/** Runs the health checks, keeps each run in SQLite for 7 days, and restarts a stopped safe unit at most once an hour. */
export class InfraHealth {
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private readonly restarts = new Map<string, number>();
  private running: Promise<HealthRun> | null = null;

  constructor(
    private readonly db: Db,
    private readonly system: System,
    private readonly hermes: Pick<Hermes, "status" | "api">,
    private readonly hermesBin: string,
  ) {}

  private context(): CheckContext {
    const { system } = this;
    return {
      system,
      hermes: this.hermes,
      hermesBin: this.hermesBin,
      cached: async <T>(key: string, ttlMs: number, load: () => Promise<T>) => {
        const hit = this.cache.get(key);
        if (hit && system.now() - hit.at < ttlMs) return hit.value as T;
        const value = await load();
        // A failed read is tried again next run instead of being kept for hours.
        if (value !== null) this.cache.set(key, { at: system.now(), value });
        return value;
      },
      restart: async (unit) => {
        const last = this.restarts.get(unit) ?? 0;
        if (system.now() - last < RESTART_GAP_MS) return false;
        this.restarts.set(unit, system.now());
        await system.run("systemctl", ["restart", `${unit}.service`], { timeoutMs: 30_000 });
        const state = await system.run("systemctl", ["is-active", `${unit}.service`]);
        const ok = state.stdout.trim() === "active";
        console.log(`infra: restarted ${unit}: ${ok ? "running" : "still down"}`);
        return ok;
      },
    };
  }

  latest(): HealthRun | null {
    const row = this.db.select().from(infraRuns).orderBy(desc(infraRuns.at)).limit(1).get();
    return row ? { at: row.at, tone: row.tone as Tone, checks: JSON.parse(row.checks) as Check[] } : null;
  }

  /** The runs of the last `hours`, oldest first. */
  history(hours = 24): HealthMark[] {
    const rows = this.db
      .select()
      .from(infraRuns)
      .where(gte(infraRuns.at, this.system.now() - hours * 3_600_000))
      .orderBy(infraRuns.at)
      .all();
    return rows.map((row) => {
      const checks = JSON.parse(row.checks) as Check[];
      return { at: row.at, tone: row.tone as Tone, bad: checks.filter((c) => c.tone === "bad").length, warn: checks.filter((c) => c.tone === "warn").length };
    });
  }

  /** One run at a time: a second call while one runs waits for the same answer. */
  run(): Promise<HealthRun> {
    this.running ??= this.collect().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** "Check now": the last run when it is only seconds old, a new one otherwise. */
  async runIfStale(): Promise<HealthRun> {
    const last = this.latest();
    if (last && this.system.now() - last.at < MIN_GAP_MS) return last;
    return this.run();
  }

  private async collect(): Promise<HealthRun> {
    const checks = await runChecks(this.context());
    const run: HealthRun = { at: this.system.now(), tone: worst(checks.map((check) => check.tone)), checks };
    this.db.insert(infraRuns).values({ at: run.at, tone: run.tone, checks: JSON.stringify(checks) }).run();
    this.db.delete(infraRuns).where(lt(infraRuns.at, run.at - KEEP_MS)).run();
    return run;
  }
}
