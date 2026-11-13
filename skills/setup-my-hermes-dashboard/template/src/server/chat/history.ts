import type { Part, ToolPart } from "@/lib/chat/events";
import type { AssistantItem, ChatItem } from "@/lib/chat/items";
import { toMs } from "@/server/hermes";

/**
 * A Hermes session's messages (`GET /api/sessions/{id}/messages`) as the thread shows them: one user item per user
 * message, one assistant item for everything Hermes did until the next one (comments, tool steps with their result,
 * reasoning, the final answer). Also the reverse for a regenerate: the messages to send back as `conversation_history`.
 */

export type HermesMessage = {
  id?: string | number;
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string | null;
  tool_name?: string | null;
  timestamp?: number | string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  display_kind?: string | null;
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Message rows only: `session_meta` and hidden scaffolding never show. */
export function messageRows(data: unknown): HermesMessage[] {
  const rows = Array.isArray((data as { data?: unknown } | null)?.data) ? ((data as { data: unknown[] }).data as HermesMessage[]) : [];
  return rows.filter((row) => row && typeof row === "object" && ["user", "assistant", "tool"].includes(row.role) && row.display_kind !== "hidden");
}

/** Text of a message: a string, or the text parts of a list. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (part && typeof part === "object" && (part as { type?: string }).type === "text" ? str((part as { text?: unknown }).text) : "")).join("\n");
  return "";
}

/** Hermes writes `[Image attached at: …/api_<sha256[:32]>.png]` under the text of a message sent with images. */
const IMAGE = /\n*\[Image attached at: ([^\]\n]*)\]/g;

export function splitImages(text: string): { text: string; hashes: string[] } {
  const hashes: string[] = [];
  let found = false;
  const rest = text.replace(IMAGE, (_, file: string) => {
    found = true;
    hashes.push(/api_([0-9a-f]{32})\.\w+$/.exec(file)?.[1] ?? "");
    return "";
  });
  return { text: (found ? rest.replace(/\n*\[screenshot\]\s*$/g, "") : rest).trim(), hashes };
}

type ToolCall = { id: string; name: string; args: string };

function toolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((call) => {
    const fn = (call as { function?: { name?: unknown; arguments?: unknown } } | null)?.function;
    const id = str((call as { id?: unknown }).id) || str((call as { call_id?: unknown }).call_id);
    return fn && id ? [{ id, name: str(fn.name) || "outil", args: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}) }] : [];
  });
}

/** What a tool was asked, in one line: its command, path, query or first text argument. */
export function argsPreview(args: string): string {
  let value: unknown = args;
  try {
    value = JSON.parse(args);
  } catch {
    // Not JSON: shown as is.
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const key = ["command", "cmd", "query", "path", "url", "name", "skill", "goal", "pattern"].find((k) => typeof record[k] === "string" && record[k]);
    value = key ? record[key] : Object.values(record).find((v) => typeof v === "string" && v) ?? "";
  }
  const line = String(value ?? "").replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

/** A tool result: failed when it says so (`error`, a non-zero `exit_code`, a `BLOCKED:` refusal). */
export function toolOutcome(content: unknown): { failed: boolean; summary: string } {
  const text = textOf(content);
  let failed = /^\s*(BLOCKED:|Error:)/.test(text);
  let summary = text;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      if ((parsed.error !== undefined && parsed.error !== null && parsed.error !== false && parsed.error !== "") || (typeof parsed.exit_code === "number" && parsed.exit_code !== 0)) failed = true;
      const out = parsed.output ?? parsed.result ?? parsed.content ?? parsed.error;
      if (typeof out === "string" && out.trim()) summary = out;
    }
  } catch {
    // Plain text result.
  }
  summary = summary.trim();
  return { failed, summary: summary.length > 500 ? `${summary.slice(0, 497)}…` : summary };
}

export type HistoryContext = {
  /** Thumbnail of an image hash ("" when unknown). */
  thumb: (hash: string) => string;
  /** The model that answered at that time (ms), when the dashboard knows. */
  modelAt: (at: number | null) => string | null;
};

export function toItems(rows: HermesMessage[], context: HistoryContext): ChatItem[] {
  const items: ChatItem[] = [];
  let turn: AssistantItem | null = null;
  const assistant = (row: HermesMessage, index: number): AssistantItem => {
    if (!turn) {
      turn = { role: "assistant", id: `a-${row.id ?? index}`, parts: [], model: null, at: toMs(row.timestamp) };
      items.push(turn);
    }
    return turn;
  };
  rows.forEach((row, index) => {
    if (row.role === "user") {
      turn = null;
      const { text, hashes } = splitImages(textOf(row.content));
      items.push({ role: "user", id: `u-${row.id ?? index}`, text, images: hashes.map((hash) => (hash ? context.thumb(hash) : "")), at: toMs(row.timestamp) });
      return;
    }
    const current = assistant(row, index);
    if (row.role === "tool") {
      const id = str(row.tool_call_id);
      const outcome = toolOutcome(row.content);
      const step = current.parts.find((p): p is ToolPart => p.kind === "tool" && p.id === id);
      if (step) Object.assign(step, { status: outcome.failed ? "error" : "done", result: outcome.summary || undefined });
      else current.parts.push({ kind: "tool", id: id || `tool-${index}`, name: str(row.tool_name) || "outil", preview: "", status: outcome.failed ? "error" : "done", result: outcome.summary || undefined });
      return;
    }
    const reasoning = (str(row.reasoning_content) || str(row.reasoning)).trim();
    if (reasoning) current.parts.push({ kind: "reasoning", text: reasoning });
    const text = textOf(row.content).trim();
    if (text) current.parts.push({ kind: "text", text });
    for (const call of toolCalls(row.tool_calls)) current.parts.push({ kind: "tool", id: call.id, name: call.name, preview: argsPreview(call.args), status: "done" } satisfies Part);
    const at = toMs(row.timestamp);
    current.at = at ?? current.at;
    current.model = context.modelAt(at) ?? current.model;
  });
  return items.filter((item) => item.role === "user" || item.parts.length > 0);
}

/**
 * The turns sent back as `conversation_history`. Hermes keeps only `role` and `content` of each entry, so tool calls
 * and their results are written into the assistant's text (« [Outil terminal : uptime → …] ») and the tool rows
 * themselves are left out; consecutive assistant texts make one message.
 */
export function toHistory(rows: HermesMessage[]): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  const results = new Map(rows.filter((r) => r.role === "tool").map((r) => [str(r.tool_call_id), toolOutcome(r.content)]));
  const say = (role: "user" | "assistant", text: string) => {
    if (!text.trim()) return;
    const last = out[out.length - 1];
    if (last?.role === role && role === "assistant") last.content += `\n\n${text}`;
    else out.push({ role, content: text });
  };
  for (const row of rows) {
    if (row.role === "user") say("user", textOf(row.content));
    else if (row.role === "assistant") {
      const lines = [textOf(row.content).trim()];
      for (const call of toolCalls(row.tool_calls)) {
        const result = results.get(call.id);
        lines.push(`[Tool ${call.name}: ${argsPreview(call.args) || "—"}${result ? ` → ${result.failed ? "failed: " : ""}${result.summary.slice(0, 1_000) || "(empty)"}` : ""}]`);
      }
      say("assistant", lines.filter(Boolean).join("\n"));
    }
  }
  return out;
}

/** Kept in the conversation for a regenerate: the fields needed to show and resend, tool outputs capped at 20 000 characters. */
export function slim(rows: HermesMessage[]): HermesMessage[] {
  return rows.map((row) => {
    const content = textOf(row.content);
    return {
      id: row.id,
      role: row.role,
      content: row.role === "tool" && content.length > 20_000 ? `${content.slice(0, 20_000)}…` : content,
      tool_calls: row.tool_calls ?? null,
      tool_call_id: row.tool_call_id ?? null,
      tool_name: row.tool_name ?? null,
      timestamp: row.timestamp ?? null,
      reasoning: row.reasoning ?? null,
      reasoning_content: row.reasoning_content ?? null,
    };
  });
}

/** Index of the last user message (where a regenerate or an edit cuts), or -1. */
export const lastUserIndex = (rows: HermesMessage[]) => rows.map((r) => r.role).lastIndexOf("user");
