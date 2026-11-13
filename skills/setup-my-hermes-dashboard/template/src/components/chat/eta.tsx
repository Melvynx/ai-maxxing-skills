import * as React from "react";

import { etaLabel, parseEta, pickEta, remainingShort, type Eta } from "@/lib/chat/eta";
import type { Part } from "@/lib/chat/events";

import { useMounted } from "./avatar";

/** The time, every second while `on` (the countdowns; read only in the browser, never in the server HTML). */
export function useNow(on = true): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/**
 * The live run's estimate: Hermes's latest « ⏱️ Plus que ~N min » in what it streamed so far (dated when the page saw
 * it, or the server's time when it holds the same value), else the stored one (Hermes's, or the usual duration).
 */
export function useLiveEta(runId: string | null, parts: Part[], stored: Eta | null | undefined): Eta | null {
  const text = React.useMemo(() => parts.map((p) => (p.kind === "text" ? p.text : "")).join("\n"), [parts]);
  const parsed = React.useMemo(() => parseEta(text), [text]);
  const [seen, setSeen] = React.useState<{ runId: string | null; seconds: number; seenAt: number } | null>(null);
  // Derived state: a new value is dated the first time this page reads it.
  if (parsed !== null && (seen?.runId !== runId || seen.seconds !== parsed)) setSeen({ runId, seconds: parsed, seenAt: Date.now() });
  const current = seen && seen.runId === runId && parsed !== null ? seen : null;
  return pickEta(current, stored);
}

/** The live turn's pill: « ⏱️ ~2 min restantes », « ⏱️ ~4 min (estimation habituelle) », then « Bientôt fini… ». */
export function EtaPill({ eta }: { eta: Eta }) {
  const mounted = useMounted();
  const now = useNow();
  if (!mounted) return null;
  return (
    <p className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs text-muted-foreground tabular-nums" data-testid="chat-eta" data-estimated={eta.estimated ? "1" : undefined}>
      <span aria-hidden>⏱️</span>
      <span className="truncate">{etaLabel(eta, now)}</span>
    </p>
  );
}

/** Next to a running conversation in the list: « ⏱️ ~3 min », then « bientôt ». */
export function ListEta({ eta }: { eta: Eta }) {
  const mounted = useMounted();
  const now = useNow();
  if (!mounted) return null;
  const short = remainingShort(eta.seconds, eta.at, now);
  return (
    <span className="ms-auto shrink-0 text-2xs text-muted-foreground tabular-nums" title={eta.estimated ? "Usual time of your answers" : "Estimate from Hermes"} data-testid="chat-list-eta">
      ⏱️ {short ?? "soon"}
    </span>
  );
}
