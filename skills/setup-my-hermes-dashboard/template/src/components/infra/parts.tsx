import { Link, useRouter } from "@tanstack/react-router";
import { ServerCog, Wrench } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Page } from "@/components/hub/page";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ago, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { launchInfraFix } from "@/server/infra/functions";
import { isOpen, type Fix, type FixDraft, type FixStatus, type HealthMark, type Tone, type Verdict } from "@/server/infra/model";

const TABS = [
  { to: "/infra/health", label: "Health" },
  { to: "/infra/audit", label: "Daily audit" },
] as const;

/** Both Infra pages: the Infra header, then the two tabs. */
export function InfraPage({ tab, hint, actions, children }: { tab: (typeof TABS)[number]["to"]; hint: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Page section="infra" hint={hint} actions={actions} testId="infra">
      <nav aria-label="Infra" className="mb-6 flex gap-1 border-b" data-testid="infra-tabs">
        {TABS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            aria-current={item.to === tab ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40",
              item.to === tab ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="grid gap-6">{children}</div>
    </Page>
  );
}

export function AdminsOnly() {
  return (
    <main className="mx-auto grid min-h-[60dvh] max-w-sm place-content-center justify-items-center gap-2 p-6 text-center" data-testid="infra-admins-only">
      <ServerCog className="mb-1 size-6 text-brand" aria-hidden />
      <h1 className="text-lg font-semibold">Infra is for admins</h1>
      <p className="text-sm text-muted-foreground">It shows how the server is set up. Ask the owner of this dashboard if you need it.</p>
    </main>
  );
}

/** While Hermes works on a task (or an audit runs), the page asks again every 30 seconds. */
export function useRefreshWhile(active: boolean) {
  const router = useRouter();
  React.useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void router.invalidate(), 30_000);
    return () => clearInterval(timer);
  }, [active, router]);
}

const TONE_TEXT: Record<Tone, string> = { good: "text-good", warn: "text-warn", bad: "text-bad", idle: "text-muted-foreground" };
const TONE_BOX: Record<Tone, string> = {
  good: "border-good-line bg-good-soft",
  warn: "border-warn-line bg-warn-soft",
  bad: "border-bad-line bg-bad-soft",
  idle: "bg-card",
};
const TONE_BAR: Record<Tone, string> = { good: "bg-good-dot", warn: "bg-warn-dot", bad: "bg-bad-dot", idle: "bg-muted-foreground/30" };

export const toneText = (tone: Tone) => TONE_TEXT[tone];
export const toneBox = (tone: Tone) => TONE_BOX[tone];

/** The last 24 hours, one bar per run (every 15 minutes), oldest on the left. */
export function HistoryStrip({ marks, now }: { marks: HealthMark[]; now: number }) {
  if (marks.length < 2) return null;
  return (
    <div className="grid gap-1.5" data-testid="infra-history">
      <div className="flex h-6 items-stretch gap-px" role="img" aria-label={`${marks.filter((m) => m.tone === "bad").length} bad runs in the last 24 hours`}>
        {marks.slice(-96).map((mark) => (
          <span
            key={mark.at}
            className={cn("min-w-0.5 flex-1 rounded-[1px]", TONE_BAR[mark.tone])}
            title={`${dateTime(mark.at)}: ${mark.bad} problem(s), ${mark.warn} warning(s)`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{ago(marks[0]!.at, now)}</span>
        <span>now</span>
      </div>
    </div>
  );
}

const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  ok: { label: "OK", tone: "good" },
  attention: { label: "Attention", tone: "warn" },
  urgent: { label: "Urgent", tone: "bad" },
  unknown: { label: "No verdict", tone: "idle" },
};

export const verdictTone = (verdict: Verdict) => VERDICT[verdict].tone;

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const { label, tone } = VERDICT[verdict];
  return <span className={cn("inline-flex h-6 items-center rounded-md border px-2 text-xs font-semibold", TONE_BOX[tone], TONE_TEXT[tone])}>{label}</span>;
}

const STATUS: Record<FixStatus, { label: string; tone: Tone }> = {
  queued: { label: "Waiting for Hermes", tone: "idle" },
  running: { label: "Hermes is on it", tone: "warn" },
  blocked: { label: "Needs you", tone: "bad" },
  done: { label: "Done", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
};

export function FixStatusPill({ status }: { status: FixStatus }) {
  const { label, tone } = STATUS[status];
  return <span className={cn("inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs font-medium", TONE_BOX[tone], TONE_TEXT[tone])}>{label}</span>;
}

/** The tasks sent to Hermes from this page, newest first. */
export function FixList({ fixes, now }: { fixes: Fix[]; now: number }) {
  if (!fixes.length) return null;
  return (
    <section className="grid gap-2" aria-label="Fixes" data-testid="infra-fixes">
      <h2 className="text-sm font-semibold">Fixes sent to Hermes</h2>
      <ul className="divide-y rounded-xl border bg-card shadow-panel">
        {fixes.slice(0, 10).map((fix) => (
          <li key={fix.id} className="grid gap-1 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{fix.title}</span>
              <FixStatusPill status={fix.status} />
            </div>
            <p className="text-xs text-muted-foreground">
              {ago(fix.createdAt, now)}
              {fix.actor ? ` · by ${fix.actor}` : ""}
              {fix.taskId ? ` · task ${fix.taskId}` : ""}
            </p>
            {fix.note ? <p className="text-sm whitespace-pre-line text-muted-foreground">{fix.note}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The fix open for this problem, if any: its button then says where the task is instead of offering a new one. */
export const openFixFor = (fixes: Fix[], key: string) => fixes.find((fix) => fix.key === key && isOpen(fix));

/**
 * "Fix" button + sheet: the task Hermes will get, editable, sent to the Hermes board. The same problem gets one open
 * task; sending it again needs a second, explicit click.
 */
export function FixButton({ draft, source, open: current }: { draft: FixDraft; source: Fix["source"]; open?: Fix }) {
  const router = useRouter();
  const [shown, setShown] = React.useState(false);
  const [prompt, setPrompt] = React.useState(draft.prompt);
  const [busy, setBusy] = React.useState(false);
  const [exists, setExists] = React.useState(false);

  async function send(again: boolean) {
    setBusy(true);
    try {
      const answer = await launchInfraFix({ data: { source, key: draft.key, title: draft.title, prompt, again } });
      if (answer.exists) {
        setExists(true);
        return;
      }
      if (answer.fix.status === "failed") toast.error(answer.fix.note ?? "Hermes did not take the task");
      else toast.success("Sent to Hermes");
      setShown(false);
      await router.invalidate();
    } catch {
      toast.error("Could not send the task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={shown}
      onOpenChange={(value) => {
        setShown(value);
        if (value) {
          setPrompt(draft.prompt);
          setExists(false);
        }
      }}
    >
      <Button type="button" size="sm" variant={current ? "ghost" : "outline"} onClick={() => setShown(true)} data-testid={`fix-${draft.key}`}>
        <Wrench aria-hidden /> {current ? STATUS[current.status].label : "Fix"}
      </Button>
      <SheetContent side="right" aria-describedby={undefined}>
        <div className="grid gap-1 pr-8">
          <SheetTitle className="text-lg">{draft.title}</SheetTitle>
          <SheetDescription>Hermes gets this task on its board and works on it on the server. Change the text if you want, then send it.</SheetDescription>
        </div>
        {current ? (
          <p className="rounded-lg border bg-card px-3 py-2 text-sm" role="status">
            Already sent {ago(current.createdAt, Date.now())}: <span className="font-medium">{STATUS[current.status].label}</span>.
          </p>
        ) : null}
        <label className="grid gap-1.5 text-sm font-medium">
          Task for Hermes
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={18}
            maxLength={8_000}
            className="min-h-64 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed font-normal shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </label>
        {exists || current ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="flex-1 text-sm text-muted-foreground">This problem already has an open task. Send a new one anyway?</p>
            <Button type="button" disabled={busy || prompt.trim().length < 10} onClick={() => void send(true)}>
              {busy ? "Sending…" : "Send again"}
            </Button>
          </div>
        ) : (
          <Button type="button" className="justify-self-start" disabled={busy || prompt.trim().length < 10} onClick={() => void send(false)}>
            {busy ? "Sending…" : "Send to Hermes"}
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}
