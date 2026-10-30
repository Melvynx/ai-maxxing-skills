import { createFileRoute } from "@tanstack/react-router";

import { json, withKey } from "@/server/api";
import { isOpen } from "@/server/infra/model";

/**
 * The Infra state for Hermes and scripts: `dashboard-cli get /api/v1/infra`. The last health run (only the checks
 * that are not fine), the last audit verdict and the fixes still open.
 */
export const Route = createFileRoute("/api/v1/infra")({
  server: {
    handlers: {
      GET: withKey("dashboard:read", async ({ app }) => {
        const { health, audit, fixes } = app.infra;
        const run = health.latest();
        const job = await audit.job().catch(() => null);
        const [report] = job ? await audit.reports(job.id, 1) : [];
        return json({
          health: run && {
            at: new Date(run.at).toISOString(),
            tone: run.tone,
            problems: run.checks.filter((c) => c.tone === "bad" || c.tone === "warn").map(({ id, tone, title, summary, detail }) => ({ id, tone, title, summary, detail })),
          },
          audit: job && {
            enabled: job.enabled,
            schedule: job.schedule,
            last: report ? { at: report.at ? new Date(report.at).toISOString() : null, verdict: report.verdict, summary: report.summary, actions: report.actions.map(({ priority, text }) => ({ priority, text })) } : null,
          },
          fixes: fixes.list().filter(isOpen).map(({ id, title, status, taskId, note }) => ({ id, title, status, taskId, note })),
        });
      }),
    },
  },
});
