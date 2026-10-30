import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getApp } from "@/server/app";
import { orNull } from "@/server/functions";
import { getViewer, requireAdmin } from "@/server/viewer";

import { FixExistsError } from "./fixes";
import type { AuditJob, AuditReport, Fix, HealthMark, HealthRun } from "./model";

/**
 * What the Infra pages read and change. Admins only: it shows how the server is set up and sends work to the agent.
 * A member gets null and the page says so.
 */

export type InfraHealthPage = { run: HealthRun | null; history: HealthMark[]; fixes: Fix[]; now: number };

export const getInfraHealth = createServerFn({ method: "GET" }).handler(async (): Promise<InfraHealthPage | null> => {
  if (getViewer().role !== "admin") return null;
  const { infra } = getApp();
  // The first visit before the first timed run still shows something.
  const run = infra.health.latest() ?? (await orNull(infra.health.run()));
  await orNull(infra.fixes.refresh());
  return { run, history: infra.health.history(), fixes: infra.fixes.list(), now: Date.now() };
});

export const checkInfraNow = createServerFn({ method: "POST" }).handler(async (): Promise<HealthRun> => {
  requireAdmin();
  return getApp().infra.health.runIfStale();
});

/** `job` is null when the audit cron does not exist (deleted, or Hermes not answering: `reachable` tells which). */
export type InfraAuditPage = { reachable: boolean; job: AuditJob | null; reports: AuditReport[]; fixes: Fix[]; now: number };

export const getInfraAudit = createServerFn({ method: "GET" }).handler(async (): Promise<InfraAuditPage | null> => {
  if (getViewer().role !== "admin") return null;
  const { infra } = getApp();
  const job = await infra.audit.job().then(
    (value) => ({ reachable: true, job: value }),
    () => ({ reachable: false, job: null }),
  );
  const reports = job.job ? await infra.audit.reports(job.job.id) : [];
  await orNull(infra.fixes.refresh());
  return { ...job, reports, fixes: infra.fixes.list(), now: Date.now() };
});

export const enableInfraAudit = createServerFn({ method: "POST" }).handler(async (): Promise<AuditJob> => {
  requireAdmin();
  return getApp().infra.audit.enable();
});

export const runInfraAudit = createServerFn({ method: "POST" }).handler(async (): Promise<{ ok: true }> => {
  requireAdmin();
  await getApp().infra.audit.runNow();
  return { ok: true };
});

/** `exists`: the same problem already had an open task (and `again` was not set), `fix` is that task. */
export type LaunchAnswer = { fix: Fix; exists: boolean };

export const launchInfraFix = createServerFn({ method: "POST" })
  .validator(
    z.object({
      source: z.enum(["health", "audit"]),
      key: z.string().max(200).regex(/^(health|audit):\S/),
      title: z.string().trim().min(1).max(120),
      prompt: z.string().trim().min(10).max(8_000),
      again: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }): Promise<LaunchAnswer> => {
    const viewer = requireAdmin();
    try {
      return { fix: await getApp().infra.fixes.launch({ ...data, actor: viewer.email }), exists: false };
    } catch (error) {
      if (error instanceof FixExistsError) return { fix: error.fix, exists: true };
      throw error;
    }
  });
