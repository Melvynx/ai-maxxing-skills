/**
 * The Chat's view of one Hermes run, shared by the server relay and the page. Hermes streams a run as SSE
 * (`GET /v1/runs/{id}/events`, relayed by `/api/hermes-chat/runs/<id>/events`): `parseSse` cuts the bytes into
 * frames, `reduceTurn` folds each event into the `Turn` the thread draws (text, tool steps, reasoning, approval and
 * question cards, the end of the run).
 */

export type RunEvent = { event: string; seq?: number } & Record<string, unknown>;

export type ToolPart = {
  kind: "tool";
  id: string;
  name: string;
  /** What it was asked (a command, a path, a query), already redacted by Hermes. */
  preview: string;
  status: "running" | "done" | "error";
  /** Seconds. */
  duration?: number;
  /** A short summary of what it answered (max ~500 characters). */
  result?: string;
};

export type ApprovalPart = {
  kind: "approval";
  promptId: string;
  generation: number;
  command: string;
  description: string;
  choices: string[];
  /** `pending` until someone answers here or elsewhere (`settled`), or the run ends (`expired`). */
  status: "pending" | "approved" | "denied" | "settled" | "expired";
};

export type ClarifyPart = {
  kind: "clarify";
  promptId: string;
  generation: number;
  question: string;
  choices: string[];
  status: "pending" | "answered" | "settled" | "expired";
  answer?: string;
};

export type Part = { kind: "text"; text: string } | { kind: "reasoning"; text: string } | ToolPart | ApprovalPart | ClarifyPart;

export type TurnStatus = "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted";

export type Turn = {
  runId: string;
  parts: Part[];
  status: TurnStatus;
  /** Why it failed, in Hermes's words (shown under a French sentence). */
  error?: string;
  /** Last event seen: a reconnect asks for what comes after it. */
  lastSeq: number;
  /** Hermes no longer had the start of the stream (a long answer replayed after a reload): the final text still arrives with the end of the run. */
  truncated: boolean;
};

export const TERMINAL: ReadonlySet<TurnStatus> = new Set(["completed", "failed", "cancelled", "interrupted"]);
export const isOver = (turn: Pick<Turn, "status">) => TERMINAL.has(turn.status);

export const newTurn = (runId: string, status: TurnStatus = "queued"): Turn => ({ runId, parts: [], status, lastSeq: -1, truncated: false });

/* ---------- SSE ---------- */

export type SseFrame = { id?: string; event?: string; data: string };

/**
 * Incremental SSE parser: feed it chunks as they come, it returns the complete frames. Comment lines (`: keepalive`)
 * are skipped, multi-line `data:` is joined, `\r\n` works.
 */
export function sseParser() {
  let buffer = "";
  return (chunk: string): SseFrame[] => {
    // A `\r` that ends a chunk meets its `\n` in the next one: the whole buffer is normalised each time.
    buffer = (buffer + chunk).replace(/\r\n/g, "\n");
    const frames: SseFrame[] = [];
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const frame: SseFrame = { data: "" };
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "data") data.push(value);
        else if (field === "id") frame.id = value;
        else if (field === "event") frame.event = value;
      }
      if (!data.length) continue;
      frame.data = data.join("\n");
      frames.push(frame);
    }
    return frames;
  };
}

/** A frame's JSON event, or null when it is not one (a broken line never stops the stream). */
export function frameEvent(frame: SseFrame): RunEvent | null {
  try {
    const value = JSON.parse(frame.data) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const event = value as RunEvent;
    if (typeof event.event !== "string") {
      if (!frame.event) return null;
      event.event = frame.event;
    }
    if (typeof event.seq !== "number" && frame.id && /^\d+$/.test(frame.id)) event.seq = Number(frame.id);
    return event;
  } catch {
    return null;
  }
}

/* ---------- Reducer ---------- */

const str = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const int = (value: unknown) => (typeof value === "number" && Number.isInteger(value) ? value : 0);

function settle<P extends ApprovalPart | ClarifyPart>(parts: Part[], kind: P["kind"], promptId: string, to: P["status"]): Part[] {
  return parts.map((part) => (part.kind === kind && part.promptId === promptId && part.status === "pending" ? ({ ...part, status: to } as Part) : part));
}

const expire = (parts: Part[]): Part[] =>
  parts.map((part) => ((part.kind === "approval" || part.kind === "clarify") && part.status === "pending" ? { ...part, status: "expired" } : part.kind === "tool" && part.status === "running" ? { ...part, status: "done" } : part));

const stillWaiting = (parts: Part[]) => parts.some((part) => (part.kind === "approval" || part.kind === "clarify") && part.status === "pending");

/** Folds one event into the turn (never mutates it). Unknown events only move `lastSeq`. */
export function reduceTurn(turn: Turn, event: RunEvent): Turn {
  if (isOver(turn)) return turn;
  const seq = typeof event.seq === "number" ? event.seq : turn.lastSeq;
  if (typeof event.seq === "number" && event.seq <= turn.lastSeq) return turn;
  const next: Turn = { ...turn, lastSeq: Math.max(turn.lastSeq, seq) };
  const parts = turn.parts;
  const last = parts[parts.length - 1];
  const running = (): TurnStatus => (stillWaiting(next.parts) ? "waiting" : "running");
  switch (event.event) {
    case "message.delta": {
      const delta = str(event.delta);
      if (!delta) return next;
      next.parts = last?.kind === "text" ? [...parts.slice(0, -1), { kind: "text", text: last.text + delta }] : [...parts, { kind: "text", text: delta.replace(/^\s+/, "") }];
      next.status = running();
      return next;
    }
    case "message.interim": {
      // Commentary Hermes also streamed as deltas is already there.
      const text = str(event.text).trim();
      if (!text || event.already_streamed === true) return next;
      next.parts = [...parts, { kind: "text", text }];
      return next;
    }
    case "reasoning.available":
    case "reasoning.delta": {
      const text = str(event.text) || str(event.delta);
      if (!text) return next;
      next.parts = last?.kind === "reasoning" ? [...parts.slice(0, -1), { kind: "reasoning", text: event.event === "reasoning.delta" ? last.text + text : text }] : [...parts, { kind: "reasoning", text }];
      next.status = running();
      return next;
    }
    case "tool.started":
    case "subagent.start": {
      const sub = event.event === "subagent.start";
      const id = str(event.tool_call_id) || str(event.subagent_id) || `step-${seq}`;
      const tool: ToolPart = { kind: "tool", id, name: sub ? "subagent" : str(event.tool) || "outil", preview: sub ? str(event.goal) || str(event.preview) : str(event.preview), status: "running" };
      next.parts = [...parts, tool];
      next.status = running();
      return next;
    }
    case "tool.completed":
    case "subagent.complete": {
      const sub = event.event === "subagent.complete";
      const id = str(event.tool_call_id) || str(event.subagent_id);
      const name = sub ? "subagent" : str(event.tool);
      // By id when Hermes gives one, else the oldest running step of that tool.
      let index = parts.findIndex((p) => p.kind === "tool" && p.status === "running" && (id ? p.id === id : p.name === name));
      if (index === -1) index = parts.findIndex((p) => p.kind === "tool" && p.status === "running" && p.name === name);
      if (index === -1) return next;
      const failed = sub ? !["completed", "success", "ok", ""].includes(str(event.status)) : event.error === true;
      const result = sub ? str(event.summary) : str(event.preview);
      const duration = typeof event.duration === "number" ? event.duration : typeof event.duration_seconds === "number" ? event.duration_seconds : undefined;
      next.parts = parts.map((p, i) => (i === index ? { ...(p as ToolPart), status: failed ? "error" : "done", duration, result: result || undefined } : p));
      return next;
    }
    case "approval.request": {
      const promptId = str(event.prompt_id) || str(event.request_id);
      if (!promptId || parts.some((p) => p.kind === "approval" && p.promptId === promptId)) return next;
      const choices = strings(event.choices);
      next.parts = [...parts, { kind: "approval", promptId, generation: int(event.execution_generation), command: str(event.command), description: str(event.description), choices: choices.length ? choices : ["once", "deny"], status: "pending" }];
      next.status = "waiting";
      return next;
    }
    case "clarify.request": {
      const promptId = str(event.prompt_id) || str(event.request_id);
      if (!promptId || parts.some((p) => p.kind === "clarify" && p.promptId === promptId)) return next;
      next.parts = [...parts, { kind: "clarify", promptId, generation: int(event.execution_generation), question: str(event.question), choices: strings(event.choices), status: "pending" }];
      next.status = "waiting";
      return next;
    }
    case "approval.settled":
    case "approval.responded": {
      const promptId = str(event.prompt_id) || str(event.request_id);
      const choice = str(event.choice);
      next.parts = settle<ApprovalPart>(parts, "approval", promptId, choice === "deny" ? "denied" : choice ? "approved" : "settled");
      next.status = running();
      return next;
    }
    case "clarify.settled": {
      next.parts = settle<ClarifyPart>(parts, "clarify", str(event.prompt_id) || str(event.request_id), "settled");
      next.status = running();
      return next;
    }
    case "replay.truncated":
      next.truncated = true;
      return next;
    case "run.queued":
      next.status = "queued";
      return next;
    case "run.completed": {
      const output = str(event.output).trim();
      let finished = expire(parts);
      const tail = finished[finished.length - 1];
      // The output is the whole final answer: it wins over deltas (a replay can miss the first ones).
      if (output) finished = tail?.kind === "text" ? [...finished.slice(0, -1), { kind: "text", text: output }] : [...finished, { kind: "text", text: output }];
      next.parts = finished;
      next.status = "completed";
      next.truncated = false;
      return next;
    }
    case "run.failed":
    case "run.cancelled":
    case "run.interrupted": {
      next.parts = expire(parts);
      next.status = event.event === "run.failed" ? "failed" : event.event === "run.cancelled" ? "cancelled" : "interrupted";
      const error = str(event.error) || str(event.turn_exit_reason);
      if (error) next.error = error;
      return next;
    }
    default:
      return next;
  }
}

/** The final answer is the text after the last step; earlier texts are Hermes's comments on the way. */
export function answerIndex(parts: Part[]): number {
  const last = parts.length - 1;
  return last >= 0 && parts[last]!.kind === "text" ? last : -1;
}
