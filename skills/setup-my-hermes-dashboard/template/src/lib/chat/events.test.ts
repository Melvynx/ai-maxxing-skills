import { answerIndex, frameEvent, isOver, newTurn, reduceTurn, sseParser, type RunEvent, type Turn } from "@/lib/chat/events";
import { APPROVAL_SSE, CANCELLED_SSE, CLARIFY_SSE, FAILED_SSE, UPTIME_SSE } from "@/lib/chat/fixtures";

const fold = (sse: string, chunk = 7, start: Turn = newTurn("run_fixture0001")) => {
  const parse = sseParser();
  let turn = start;
  // Cut in small pieces: frames span chunks like on a real connection.
  for (let i = 0; i < sse.length; i += chunk) for (const frame of parse(sse.slice(i, i + chunk))) {
    const event = frameEvent(frame);
    if (event) turn = reduceTurn(turn, event);
  }
  return turn;
};

describe("sseParser", () => {
  it("joins data lines, skips comments, reads ids and handles CRLF split across chunks", () => {
    const parse = sseParser();
    expect(parse(": keepalive\r\n\r\nid: 4\r\ndata: {\"a\":")).toEqual([]);
    expect(parse("1}\r")).toEqual([]);
    expect(parse("\n\r\nevent: x\ndata: one\ndata: two\n\n")).toEqual([
      { id: "4", data: '{"a":1}' },
      { event: "x", data: "one\ntwo" },
    ]);
  });

  it("frameEvent takes the seq from the id and ignores broken JSON", () => {
    expect(frameEvent({ id: "9", data: '{"event":"message.delta","delta":"a"}' })).toMatchObject({ event: "message.delta", seq: 9 });
    expect(frameEvent({ data: "{oops" })).toBeNull();
    expect(frameEvent({ data: "[1]" })).toBeNull();
  });
});

describe("reduceTurn", () => {
  it("folds a real run: a tool step, then the answer streamed and confirmed by run.completed", () => {
    const turn = fold(UPTIME_SSE);
    expect(turn.status).toBe("completed");
    expect(turn.lastSeq).toBe(5);
    expect(turn.parts).toEqual([
      { kind: "tool", id: "toolu_fixture1", name: "terminal", preview: "uptime", status: "done", duration: 0, result: undefined },
      { kind: "text", text: "The server has been up for 5 days, load very low: 0.21." },
    ]);
    expect(answerIndex(turn.parts)).toBe(1);
  });

  it("keeps the comment before a tool apart from the answer and shows an approval card", () => {
    const turn = fold(APPROVAL_SSE, 13);
    expect(turn.status).toBe("waiting");
    expect(turn.parts.map((p) => p.kind)).toEqual(["text", "tool", "tool", "approval"]);
    expect(turn.parts[1]).toMatchObject({ status: "done", result: "/dev/sda1  80G  41G  39G  52% /" });
    expect(turn.parts[3]).toMatchObject({ promptId: "prm_fixture1", generation: 3, command: "rm -rf /tmp/build-cache", status: "pending" });
    expect(answerIndex(turn.parts)).toBe(-1);
    const after = reduceTurn(turn, { event: "approval.settled", prompt_id: "prm_fixture1", seq: 9 });
    expect(after.parts[3]).toMatchObject({ status: "settled" });
    expect(after.status).toBe("running");
    const denied = reduceTurn(turn, { event: "approval.responded", request_id: "prm_fixture1", choice: "deny", seq: 9 });
    expect(denied.parts[3]).toMatchObject({ status: "denied" });
  });

  it("shows a clarify question and settles it", () => {
    const turn = fold(CLARIFY_SSE);
    expect(turn.status).toBe("waiting");
    expect(turn.parts[1]).toMatchObject({ kind: "clarify", question: "Which period do you want the sales for?", choices: ["Yesterday", "The last 7 days"], status: "pending" });
    expect(reduceTurn(turn, { event: "clarify.settled", prompt_id: "clr_fixture1", seq: 5 }).parts[1]).toMatchObject({ status: "settled" });
  });

  it("ends failed with the error, the failed tool visible", () => {
    const turn = fold(FAILED_SSE);
    expect(turn.status).toBe("failed");
    expect(turn.error).toBe("Provider returned 529 overloaded");
    expect(turn.parts[1]).toMatchObject({ kind: "tool", status: "error", result: "Error: provider timeout" });
  });

  it("ends cancelled, keeping the text written so far; pending cards expire", () => {
    const turn = fold(CANCELLED_SSE);
    expect(turn.status).toBe("cancelled");
    expect(turn.error).toBe("interrupted_by_user");
    expect(turn.parts).toEqual([{ kind: "text", text: "Here is a long text that" }]);
    const stopped = reduceTurn(fold(APPROVAL_SSE), { event: "run.cancelled", seq: 20 });
    expect(stopped.parts.find((p) => p.kind === "approval")).toMatchObject({ status: "expired" });
    expect(isOver(stopped)).toBe(true);
  });

  it("ignores events already seen (a reconnect replays from the start) and anything after the end", () => {
    const once = fold(UPTIME_SSE);
    const twice = fold(UPTIME_SSE, 7, { ...newTurn("run_fixture0001"), ...fold(UPTIME_SSE.split("id: 3")[0]!), status: "running" });
    expect(twice.parts).toEqual(once.parts);
    expect(reduceTurn(once, { event: "message.delta", delta: "late", seq: 99 })).toBe(once);
  });

  it("after a truncated replay, the final output replaces the partial text", () => {
    let turn = reduceTurn(newTurn("r"), { event: "replay.truncated", oldest_retained_seq: 40 } as RunEvent);
    turn = reduceTurn(turn, { event: "message.delta", delta: "end of the text", seq: 40 });
    expect(turn.truncated).toBe(true);
    turn = reduceTurn(turn, { event: "run.completed", output: "Start and end of the text", seq: 41 });
    expect(turn.parts).toEqual([{ kind: "text", text: "Start and end of the text" }]);
    expect(turn.truncated).toBe(false);
  });

  it("streams reasoning apart and tracks subagents as steps", () => {
    let turn = reduceTurn(newTurn("r"), { event: "reasoning.available", text: "Je dois d'abord…", seq: 0 });
    turn = reduceTurn(turn, { event: "subagent.start", subagent_id: "sa1", goal: "Read the sales", seq: 1 });
    turn = reduceTurn(turn, { event: "subagent.complete", subagent_id: "sa1", status: "failed", summary: "timeout", seq: 2 });
    expect(turn.parts).toEqual([
      { kind: "reasoning", text: "Je dois d'abord…" },
      { kind: "tool", id: "sa1", name: "subagent", preview: "Read the sales", status: "error", duration: undefined, result: "timeout" },
    ]);
  });
});
