import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Play } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Dot, Empty, Unavailable } from "@/components/hub/page";
import { AdminsOnly, FixButton, FixList, InfraPage, openFixFor, useRefreshWhile, verdictTone, VerdictPill } from "@/components/infra/parts";
import { Button } from "@/components/ui/button";
import { ago, dateTime, until } from "@/lib/format";
import { cn } from "@/lib/utils";
import { enableInfraAudit, getInfraAudit, runInfraAudit, type InfraAuditPage } from "@/server/infra/functions";
import { isOpen, type AuditReport, type Fix } from "@/server/infra/model";

export const Route = createFileRoute("/infra/audit")({
  loader: () => getInfraAudit(),
  head: () => ({ meta: [{ title: "Daily audit · Infra · Hermes" }] }),
  component: AuditPage,
});

const HINT = "Every morning Hermes looks over the server and writes a report. It only looks; each action below is a task you choose to send.";

function AuditPage() {
  const data = Route.useLoaderData();
  if (!data) return <AdminsOnly />;
  return <Audit data={data} />;
}

function Audit({ data }: { data: InfraAuditPage }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  // A report asked for with "Run now": the page asks again until a newer one lands (a run takes a few minutes).
  const [waitingSince, setWaitingSince] = React.useState<number | null>(null);
  const [picked, setPicked] = React.useState(0);
  const { reachable, job, reports, fixes, now } = data;
  const auditFixes = fixes.filter((fix) => fix.source === "audit");
  const landed = waitingSince !== null && (reports[0]?.at ?? 0) >= waitingSince;
  React.useEffect(() => {
    if (landed) {
      setWaitingSince(null);
      setPicked(0);
    }
  }, [landed]);
  useRefreshWhile(waitingSince !== null || auditFixes.some(isOpen));

  async function act(action: "enable" | "run") {
    setBusy(true);
    try {
      if (action === "enable") {
        await enableInfraAudit();
        toast.success("Daily audit on");
      } else {
        // Run file names are on the server clock to the second: anything newer than a minute ago is the new one.
        setWaitingSince(Date.now() - 60_000);
        await runInfraAudit();
        toast.success("Audit started, the report shows here in a few minutes");
      }
      await router.invalidate();
    } catch {
      setWaitingSince(null);
      toast.error(action === "enable" ? "Could not turn the audit on" : "Could not start the audit");
    } finally {
      setBusy(false);
    }
  }

  if (!reachable) {
    return (
      <InfraPage tab="/infra/audit" hint={HINT}>
        <Unavailable what="The daily audit" />
      </InfraPage>
    );
  }

  if (!job || !job.enabled) {
    return (
      <InfraPage tab="/infra/audit" hint={HINT}>
        <Empty title={job ? "The daily audit is paused" : "The daily audit is off"}>
          <p>Hermes checks the server every morning at 7 and writes a short report here (and in your chat when one is connected).</p>
          <Button type="button" className="mt-4" onClick={() => void act("enable")} disabled={busy} data-testid="infra-audit-enable">
            {busy ? "Turning on…" : "Turn it on"}
          </Button>
        </Empty>
      </InfraPage>
    );
  }

  const report = reports[picked] ?? null;
  const actions = (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">Next {until(job.nextRunAt, now)}</span>
      <Button type="button" size="sm" variant="outline" onClick={() => void act("run")} disabled={busy || waitingSince !== null} data-testid="infra-audit-run">
        <Play aria-hidden /> {waitingSince !== null ? "Running…" : "Run now"}
      </Button>
    </div>
  );

  return (
    <InfraPage tab="/infra/audit" hint={HINT} actions={actions}>
      {job.lastStatus === "error" && job.lastError ? (
        <p className="rounded-lg border border-bad-line bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
          The last run failed: {job.lastError}
        </p>
      ) : null}
      {report ? <Report report={report} fixes={fixes} now={now} /> : <Empty title="No report yet">The first one comes tomorrow morning, or now with "Run now".</Empty>}
      <FixList fixes={auditFixes} now={now} />
      {reports.length > 1 ? (
        <section className="grid gap-2" aria-label="Past reports" data-testid="infra-audit-past">
          <h2 className="text-sm font-semibold">Past reports</h2>
          <ul className="divide-y rounded-xl border bg-card shadow-panel">
            {reports.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setPicked(index)}
                  aria-current={index === picked ? "true" : undefined}
                  className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40", index === picked && "bg-accent")}
                >
                  <Dot tone={verdictTone(item.verdict)} />
                  <span className="w-32 shrink-0 text-xs text-muted-foreground">{item.at ? dateTime(item.at) : item.id}</span>
                  <span className="min-w-0 flex-1 truncate">{item.summary ?? "No summary"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </InfraPage>
  );
}

function Report({ report, fixes, now }: { report: AuditReport; fixes: Fix[]; now: number }) {
  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4 shadow-panel sm:p-5" aria-label="Report" data-testid="infra-audit-report">
      <header className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <VerdictPill verdict={report.verdict} />
          <span className="text-xs text-muted-foreground">{report.at ? `${dateTime(report.at)} · ${ago(report.at, now)}` : report.id}</span>
        </div>
        {report.summary ? <p className="text-md font-medium">{report.summary}</p> : null}
      </header>

      {report.actions.length ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Actions</h3>
          <ul className="grid gap-2">
            {report.actions.map((action) => (
              <li key={action.fix.key} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-5 shrink-0 items-center rounded px-1.5 font-mono text-xs font-semibold",
                    action.priority === "P0" ? "bg-bad-solid text-bad-solid-fg" : action.priority === "P1" ? "bg-warn-solid text-warn-solid-fg" : "bg-muted text-muted-foreground",
                  )}
                >
                  {action.priority}
                </span>
                <p className="min-w-0 flex-1 text-sm">{action.text}</p>
                <FixButton draft={action.fix} source="audit" open={openFixFor(fixes, action.fix.key)} />
              </li>
            ))}
          </ul>
        </div>
      ) : report.verdict === "ok" ? (
        <p className="text-sm text-muted-foreground">Nothing to do.</p>
      ) : null}

      {report.sections.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {report.sections.map((section) => (
            <div key={section.title} className="grid content-start gap-1.5">
              <h3 className="text-sm font-semibold">{section.title}</h3>
              <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
                {section.lines.length ? section.lines.map((line, index) => <li key={index}>{line}</li>) : <li>Nothing noted</li>}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Full report</summary>
        <pre className="mt-2 max-h-[32rem] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">{report.raw}</pre>
      </details>
    </section>
  );
}
