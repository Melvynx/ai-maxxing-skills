import type { Db } from "@/server/db/client";
import type { Settings } from "@/server/env";
import type { Hermes } from "@/server/hermes";

import { InfraAudit } from "./audit";
import { InfraFixes } from "./fixes";
import { InfraHealth } from "./health";
import { realSystem, type System } from "./system";

const EVERY_MS = 15 * 60_000;
const FIRST_MS = 30_000;

/** The Infra module: health checks, the daily audit cron and the fix tasks, sharing one machine and one Hermes. */
export class Infra {
  readonly health: InfraHealth;
  readonly audit: InfraAudit;
  readonly fixes: InfraFixes;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    db: Db,
    hermes: Hermes,
    private readonly settings: Pick<Settings, "hermesBin" | "hermesHome" | "infraAudit">,
    system: System = realSystem,
  ) {
    this.health = new InfraHealth(db, system, hermes, settings.hermesBin);
    this.audit = new InfraAudit(db, system, hermes, settings.hermesHome);
    this.fixes = new InfraFixes(db, system, settings.hermesBin);
  }

  /** Checks 30 seconds after start, then every 15 minutes. The timer never keeps the process alive. */
  start() {
    if (this.timer) return;
    const tick = async () => {
      try {
        await this.health.run();
        if (this.settings.infraAudit) await this.audit.seed();
      } catch (error) {
        console.error("infra: check failed", error);
      }
    };
    setTimeout(() => void tick(), FIRST_MS).unref();
    this.timer = setInterval(() => void tick(), EVERY_MS);
    this.timer.unref();
  }
}
