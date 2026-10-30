import { Link } from "@tanstack/react-router";
import { Activity, ArrowRight, ArrowUpRight, HardDrive, MessageCircle, Sparkles } from "lucide-react";
import * as React from "react";

import { SECTION_NAMES, SectionMark } from "@/components/brand";
import { INFRA, ITEMS } from "@/components/hub/sidebar";
import { Dot, type Tone } from "@/components/hub/page";
import { count } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HomeSummary } from "@/server/functions";

const greeting = (hour: number) => (hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");

function Signal({ icon: Icon, title, value, detail, tone }: { icon: typeof Activity; title: string; value: string; detail: string; tone: Tone }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <Dot tone={tone} className="size-2.5" />
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className={cn("truncate text-sm font-semibold", tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>{value}</p>
      </div>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block md:hidden xl:block">{detail}</span>
    </div>
  );
}

/** Three lights on top: is the agent up, is the chat connected, is the server disk fine. */
function OpsStrip({ summary }: { summary: HomeSummary }) {
  const status = summary.status;
  const disk = status?.disk ?? null;
  const platforms = status?.platforms ?? [];
  return (
    <section className="grid gap-2 md:col-span-6 md:grid-cols-3 xl:col-span-12" aria-label="Agent health" data-testid="home-ops">
      <Signal
        icon={Activity}
        title="Agent"
        value={status ? (status.overall === "ok" ? "Running" : status.gatewayRunning ? "Running, degraded" : "Running, chat stopped") : "Unreachable"}
        detail={status ? `Hermes ${status.version}${summary.model ? ` · ${summary.model}` : ""}` : "is Hermes running?"}
        tone={status ? (status.overall === "ok" ? "good" : "warn") : "bad"}
      />
      <Signal
        icon={MessageCircle}
        title="Chat"
        value={!status ? "Unknown" : status.gatewayRunning ? (platforms.length ? platforms.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(", ") : "Connected") : "Stopped"}
        detail={status ? `${count(status.activeSessions)} active now` : "Telegram or Discord"}
        tone={!status ? "idle" : status.gatewayRunning ? "good" : "bad"}
      />
      <Signal
        icon={HardDrive}
        title="Server disk"
        value={disk ? `${Math.round(disk.usedPercent)}% used` : "Unknown"}
        detail={disk ? `${count(Math.round(disk.freeMb / 1024))} GB free` : "of the server"}
        tone={!disk ? "idle" : disk.usedPercent >= 90 ? "bad" : disk.usedPercent >= 75 ? "warn" : "good"}
      />
    </section>
  );
}

/** Example asks, shown while the home has no module: each one is a sentence the user sends to Hermes as is. */
const IDEAS = [
  "Add a module to my dashboard that lists my latest conversations.",
  "Add a module to my dashboard with my crons and when they run next.",
  "Every morning at 8, post a short report of my day on my dashboard.",
];

/** The default home has nothing else: the user asks Hermes for the modules they want, and Hermes builds them here. */
function NoModule() {
  return (
    <section className="flex min-w-0 flex-col gap-5 rounded-xl border border-dashed bg-card/50 p-6 md:col-span-6 xl:col-span-8" data-testid="home-empty">
      <div className="grid gap-1.5">
        <h2 className="text-md font-semibold">No module yet</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          This dashboard starts empty on purpose. Tell Hermes what you want to see and it adds the module here, then puts the new version online.
        </p>
      </div>
      <ul className="grid gap-2">
        {IDEAS.map((idea) => (
          <li key={idea} className="flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <span>"{idea}"</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        The code lives on your server in <code className="font-mono">~/projects/dashboard</code>, saved on your GitHub.
      </p>
    </section>
  );
}

/** Every module of the sidebar gets its card here on its own: the whole card is the link to its page. */
function ModuleCard({ item }: { item: (typeof ITEMS)[number] }) {
  if (!item.section) return null;
  return (
    <article
      className="group relative flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-5 shadow-panel transition-shadow hover:shadow-float md:col-span-3 xl:col-span-4"
      data-testid={`home-${item.section}`}
    >
      <header className="flex items-center gap-3">
        <SectionMark section={item.section} className="size-9" />
        <div className="grid min-w-0 flex-1">
          <h2 className="text-md font-semibold">
            <Link to={item.to} className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/40">
              {SECTION_NAMES[item.section]}
            </Link>
          </h2>
          <p className="truncate text-xs text-muted-foreground">{item.hint}</p>
        </div>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
      </header>
    </article>
  );
}

const INFRA_STATE: Record<Tone, string> = { good: "All good", warn: "Needs a look", bad: "Needs you", idle: "Not checked yet" };

/** Admins only: the last Infra check, the card links to its page. */
function InfraCard({ infra }: { infra: NonNullable<HomeSummary["infra"]> | "never" }) {
  const tone = infra === "never" ? "idle" : infra.tone;
  const problems = infra === "never" ? [] : [infra.bad && `${infra.bad} problem${infra.bad > 1 ? "s" : ""}`, infra.warn && `${infra.warn} warning${infra.warn > 1 ? "s" : ""}`].filter(Boolean);
  return (
    <article
      className="group relative flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 shadow-panel transition-shadow hover:shadow-float md:col-span-3 xl:col-span-4"
      data-testid="home-infra"
    >
      <header className="flex items-center gap-3">
        <SectionMark section="infra" className="size-9" />
        <div className="grid min-w-0 flex-1">
          <h2 className="text-md font-semibold">
            <Link to={INFRA.to} className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/40">
              {SECTION_NAMES.infra}
            </Link>
          </h2>
          <p className="truncate text-xs text-muted-foreground">{INFRA.hint}</p>
        </div>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
      </header>
      <p className="flex items-center gap-2 text-sm">
        <Dot tone={tone} className="size-2.5" />
        <span className={cn("font-medium", tone === "bad" && "text-bad", tone === "warn" && "text-warn")}>{INFRA_STATE[tone]}</span>
        {problems.length ? <span className="text-muted-foreground">· {problems.join(", ")}</span> : null}
      </p>
    </article>
  );
}

function HermesCard({ url }: { url: string }) {
  return (
    <article className="group relative flex min-w-0 flex-col gap-5 rounded-xl border bg-card p-5 shadow-panel transition-shadow hover:shadow-float md:col-span-6 xl:col-span-4">
      <header className="flex items-center gap-3">
        <SectionMark section="hermes" className="size-9" />
        <div className="grid min-w-0 flex-1">
          <h2 className="text-md font-semibold">
            <a href={url} className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/40">
              Hermes agent
            </a>
          </h2>
          <p className="truncate text-xs text-muted-foreground">Its own dashboard: chat, settings, logs</p>
        </div>
        <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden />
      </header>
      <p className="text-sm text-muted-foreground">Change the model, read the logs or chat with the agent from the browser.</p>
    </article>
  );
}

/** `items` is the sidebar by default; tests pass their own so they keep passing as modules are added. */
export function HubHome({ summary, items = ITEMS }: { summary: HomeSummary; items?: typeof ITEMS }) {
  // The greeting depends on the viewer's clock: rendered after hydration so the server and the browser agree.
  const [now, setNow] = React.useState<Date | null>(null);
  const modules = items.filter((item) => item.section);
  React.useEffect(() => setNow(new Date()), []);
  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 pt-6 pb-16 sm:px-6 sm:pt-10" data-testid="home">
      <header className="mb-6 grid gap-1">
        <h1 className="text-display font-semibold" suppressHydrationWarning>
          {now ? greeting(now.getHours()) : "Hello"}
          {summary.owner ? ` ${summary.owner}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase" suppressHydrationWarning>
          {now ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now) : " "}
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
        <OpsStrip summary={summary} />
        {modules.length ? modules.map((item) => <ModuleCard key={item.to} item={item} />) : <NoModule />}
        {summary.admin ? <InfraCard infra={summary.infra ?? "never"} /> : null}
        {summary.hermesUrl ? <HermesCard url={summary.hermesUrl} /> : null}
      </div>
    </main>
  );
}
