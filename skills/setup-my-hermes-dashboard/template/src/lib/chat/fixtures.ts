/**
 * Recorded Hermes run streams (`/v1/runs/{id}/events`), anonymised, for the tests and the dev preview of the cards
 * (`/chat?demo=approval` in dev only). `uptime` follows a real run; the others follow the same wire format
 * (gateway/platforms/api_server_runs.py, session_pending_controls.py) for what is not tested against the real Hermes.
 */

const frame = (seq: number, event: Record<string, unknown>) => `id: ${seq}\ndata: ${JSON.stringify({ ...event, run_id: "run_fixture0001", timestamp: 1794281107 + seq, seq })}\n\n`;
const stream = (events: Record<string, unknown>[]) => ": open\n\n" + events.map((e, i) => frame(i, e)).join("") + ": stream closed\n\n";

export const UPTIME_SSE = stream([
  { event: "tool.started", tool: "terminal", preview: "uptime", tool_call_id: "toolu_fixture1" },
  { event: "tool.completed", tool: "terminal", duration: 0, error: false, tool_call_id: "toolu_fixture1", preview: "" },
  { event: "message.delta", delta: "\n\nThe server has b" },
  { event: "message.delta", delta: "een up for 5 days, load " },
  { event: "message.delta", delta: "very low: 0.21." },
  { event: "run.completed", output: "The server has been up for 5 days, load very low: 0.21.", usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, runtime: { provider: "", model: "", route_source: "global" }, completed: true, partial: false, interrupted: false },
]);

export const APPROVAL_SSE = stream([
  { event: "message.delta", delta: "I will check the disk space, then clean the cache." },
  { event: "tool.started", tool: "terminal", preview: "df -h /", tool_call_id: "call_a" },
  { event: "tool.completed", tool: "terminal", duration: 0.2, error: false, tool_call_id: "call_a", preview: "/dev/sda1  80G  41G  39G  52% /" },
  { event: "tool.started", tool: "terminal", preview: "rm -rf /tmp/build-cache", tool_call_id: "call_b" },
  {
    event: "approval.request",
    kind: "approval",
    prompt_id: "prm_fixture1",
    execution_generation: 3,
    command: "rm -rf /tmp/build-cache",
    description: "Recursive delete of a folder",
    choices: ["once", "deny", "session", "always"],
  },
]);

export const CLARIFY_SSE = stream([
  { event: "message.delta", delta: "Before I run the report:" },
  { event: "clarify.request", kind: "clarify", prompt_id: "clr_fixture1", execution_generation: 2, question: "Which period do you want the sales for?", choices: ["Yesterday", "The last 7 days"], multi_select: false },
]);

export const FAILED_SSE = stream([
  { event: "message.delta", delta: "Looking" },
  { event: "tool.started", tool: "web_search", preview: "sales report", tool_call_id: "call_f" },
  { event: "tool.completed", tool: "web_search", duration: 1.2, error: true, tool_call_id: "call_f", preview: "Error: provider timeout" },
  { event: "run.failed", error: "Provider returned 529 overloaded", completed: false, partial: false, interrupted: false },
]);

export const CANCELLED_SSE = stream([
  { event: "message.delta", delta: "Here is a long text that" },
  { event: "run.cancelled", completed: false, partial: false, interrupted: true, turn_exit_reason: "interrupted_by_user" },
]);

/** Hermes's answer when every run slot is taken. */
export const BUSY_BODY = { error: { message: "Too many concurrent runs (max 10)", type: "rate_limit_error", param: null, code: "rate_limited" } };
