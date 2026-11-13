import * as React from "react";

import { frameEvent, isOver, newTurn, reduceTurn, sseParser, type RunEvent, type Turn } from "@/lib/chat/events";

/**
 * Follows a run through `/api/hermes-chat/runs/<id>/events`: folds its events into a Turn, reconnects after a cut
 * (asking only for what comes after the last event), and stops at the end of the run. Leaving the page only
 * disconnects: Hermes goes on and the page catches up when it comes back.
 */

export type ApiError = { status: number; message: string };

/** The dashboard's French error message from a JSON answer, or a sentence for the status. */
export async function apiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  const message = body?.error?.message || (response.status === 403 ? "Admins only." : response.status >= 500 ? "The dashboard cannot reach Hermes." : `Error ${response.status}.`);
  return { status: response.status, message };
}

export function useRunStream(runId: string | null, initial: Turn | null, onEnd: (turn: Turn) => void): Turn | null {
  const [turn, setTurn] = React.useState<Turn | null>(initial);
  const endRef = React.useRef(onEnd);
  endRef.current = onEnd;

  React.useEffect(() => {
    if (!runId) {
      setTurn(null);
      return;
    }
    const abort = new AbortController();
    let current = initial?.runId === runId ? initial : newTurn(runId, "running");
    setTurn(current);
    const apply = (event: RunEvent) => {
      const next = reduceTurn(current, event);
      if (next === current) return;
      current = next;
      setTurn(next);
      if (isOver(next)) endRef.current(next);
    };
    (async () => {
      let failures = 0;
      while (!abort.signal.aborted && !isOver(current)) {
        try {
          const response = await fetch(`/api/hermes-chat/runs/${encodeURIComponent(runId)}/events?after=${current.lastSeq}`, { signal: abort.signal, headers: { Accept: "text/event-stream" }, cache: "no-store" });
          if (!response.ok) {
            const error = await apiError(response);
            // Gone or refused will not get better by retrying.
            if (response.status === 403 || response.status === 404) return apply({ event: "run.interrupted", error: error.message });
            throw new Error(error.message);
          }
          let got = false;
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          const parse = sseParser();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const frame of parse(decoder.decode(value, { stream: true }))) {
              const event = frameEvent(frame);
              if (!event) continue;
              got = true;
              failures = 0;
              apply(event);
            }
          }
          // Closed without a word (Hermes no longer streams a run that still goes on): ask again, slower each time.
          if (!got) failures += 1;
          if (failures >= 40) return apply({ event: "run.interrupted", error: "Hermes no longer streams this answer. Reload the page a bit later." });
        } catch (error) {
          if (abort.signal.aborted) return;
          failures += 1;
          if (failures >= 40) return apply({ event: "run.interrupted", error: error instanceof Error ? error.message : "Connexion perdue." });
        }
        if (!isOver(current) && !abort.signal.aborted) await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, 500 * 2 ** Math.min(failures, 3))));
      }
    })();
    return () => abort.abort();
    // `initial` is read once per run id on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return turn;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw Object.assign(new Error((await apiError(response)).message), { status: response.status });
  return (await response.json()) as T;
}
