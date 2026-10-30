import { CircleAlert, ShieldCheck } from "lucide-react";
import * as React from "react";

import { SectionTitle, type Section } from "@/components/brand";
import { cn } from "@/lib/utils";

/** Every page: the same width, gutters and header (section mark, name, one line of help, optional actions). */
export function Page({ section, hint, actions, children, testId }: { section: Section; hint: string; actions?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-4 pt-6 pb-16 sm:px-6 sm:pt-10" data-testid={testId}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <SectionTitle section={section} />
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}

export type Tone = "good" | "warn" | "bad" | "idle";

const DOT: Record<Tone, string> = { good: "bg-good-dot", warn: "bg-warn-dot", bad: "bg-bad-dot", idle: "bg-muted-foreground/50" };

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", DOT[tone], className)} aria-hidden />;
}

/** A piece Hermes could not give right now: says so without breaking the page. */
export function Unavailable({ what, className }: { what: string; className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)} role="status">
      <CircleAlert className="size-4 text-warn" aria-hidden />
      {what} unavailable right now. Is Hermes running?
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-1.5 rounded-xl border border-dashed bg-card/60 px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

/** Rounded table frame shared by the list pages. */
export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-panel">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            {head.map((label, index) => (
              <th key={index} className="px-3 py-2.5 font-medium whitespace-nowrap">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

/** What a member sees on an admins-only page (the server sends them nothing). */
export function AdminsOnly({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <main className="mx-auto grid min-h-[60dvh] max-w-sm place-content-center justify-items-center gap-2 p-6 text-center" data-testid={testId ?? "admins-only"}>
      <ShieldCheck className="mb-1 size-6 text-brand" aria-hidden />
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{children}</p>
    </main>
  );
}
