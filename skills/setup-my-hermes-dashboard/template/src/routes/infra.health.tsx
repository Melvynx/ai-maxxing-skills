import { createFileRoute, useRouter } from "@tanstack/react-router";
import { RefreshCw, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Dot } from "@/components/hub/page";
import { AdminsOnly, FixButton, FixList, HistoryStrip, InfraPage, openFixFor, toneBox, toneText, useRefreshWhile } from "@/components/infra/parts";
import { Button } from "@/components/ui/button";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { checkInfraNow, getInfraHealth, type InfraHealthPage } from "@/server/infra/functions";
import { CATEGORIES, isOpen, type Check, type Fix } from "@/server/infra/model";

export const Route = createFileRoute("/infra/health")({
  loader: () => getInfraHealth(),
  head: () => ({ meta: [{ title: "Infra · Hermes" }] }),
  component: HealthPage,
});

const HINT = "Checked every 15 minutes. Stopped services are restarted on their own; the rest becomes a task you send to Hermes.";

function HealthPage() {
  const data = Route.useLoaderData();
  if (!data) return <AdminsOnly />;
  return <Health data={data} />;
}

function Health({ data }: { data: InfraHealthPage }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const { run, history, fixes, now } = data;
  useRefreshWhile(fixes.some(isOpen));

  async function checkNow() {
    setBusy(true);
    try {
      await checkInfraNow();
      await router.invalidate();
    } catch {
      toast.error("Could not run the checks");
    } finally {
      setBusy(false);
    }
  }

  const actions = (
    <div className="flex items-center gap-3">
      {run ? <span className="text-xs text-muted-foreground">Checked {ago(run.at, now)}</span> : null}
      <Button type="button" size="sm" variant="outline" onClick={() => void checkNow()} disabled={busy} data-testid="infra-check-now">
        <RefreshCw className={cn(busy && "animate-spin")} aria-hidden /> {busy ? "Checking…" : "Check now"}
      </Button>
    </div>
  );

  if (!run) {
    return (
      <InfraPage tab="/infra/health" hint={HINT} actions={actions}>
        <p className="text-sm text-muted-foreground">No check yet. Press "Check now" to run the first one.</p>
      </InfraPage>
    );
  }

  const bad = run.checks.filter((check) => check.tone === "bad");
  const warn = run.checks.filter((check) => check.tone === "warn");
  const fixed = run.checks.filter((check) => check.autoFixed);
  return (
    <InfraPage tab="/infra/health" hint={HINT} actions={actions}>
      <section className={cn("grid gap-4 rounded-xl border p-4 shadow-panel sm:p-5", toneBox(run.tone))} aria-label="Overall" data-testid="infra-overall">
        <div className="flex flex-wrap items-center gap-3">
          <Dot tone={run.tone} className="size-3" />
          <h2 className={cn("text-md font-semibold", toneText(run.tone))}>
            {bad.length ? `${bad.length} problem${bad.length > 1 ? "s" : ""} to fix` : warn.length ? `${warn.length} thing${warn.length > 1 ? "s" : ""} to look at` : "All good"}
          </h2>
          <span className="text-sm text-muted-foreground">
            {run.checks.length} checks{warn.length && bad.length ? `, ${warn.length} warning${warn.length > 1 ? "s" : ""}` : ""}
          </span>
        </div>
        {fixed.length ? (
          <p className="flex items-start gap-2 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            {fixed.map((check) => check.autoFixed).join(" · ")}
          </p>
        ) : null}
        <HistoryStrip marks={history} now={now} />
      </section>

      <FixList fixes={fixes} now={now} />

      <div className="grid gap-4 lg:grid-cols-2">
        {CATEGORIES.map((category) => {
          const checks = run.checks.filter((check) => check.category === category.id);
          if (!checks.length) return null;
          return (
            <section key={category.id} className="grid content-start gap-1 rounded-xl border bg-card shadow-panel" aria-label={category.title} data-testid={`infra-${category.id}`}>
              <header className="grid gap-0.5 border-b px-4 py-3">
                <h2 className="text-sm font-semibold">{category.title}</h2>
                <p className="text-xs text-muted-foreground">{category.hint}</p>
              </header>
              <ul className="divide-y">
                {checks.map((check) => (
                  <CheckRow key={check.id} check={check} fixes={fixes} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </InfraPage>
  );
}

function CheckRow({ check, fixes }: { check: Check; fixes: Fix[] }) {
  const loud = check.tone === "bad" || check.tone === "warn";
  return (
    <li className="grid gap-1.5 px-4 py-3" data-testid={`check-${check.id}`} data-tone={check.tone}>
      <div className="flex items-start gap-3">
        <Dot tone={check.tone} className="mt-1.5" />
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-sm font-medium">{check.title}</p>
          <p className={cn("text-sm", loud ? toneText(check.tone) : "text-muted-foreground")}>{check.summary}</p>
        </div>
        {check.fix ? <FixButton draft={check.fix} source="health" open={openFixFor(fixes, check.fix.key)} /> : null}
      </div>
      {loud && check.detail?.length ? (
        <ul className="ml-5 grid gap-0.5 font-mono text-xs break-words text-muted-foreground">
          {check.detail.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
      {check.autoFixed ? <p className="ml-5 text-xs text-brand-ink">{check.autoFixed}</p> : null}
    </li>
  );
}
