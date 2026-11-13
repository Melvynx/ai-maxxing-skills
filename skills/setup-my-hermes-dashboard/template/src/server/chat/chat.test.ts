import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { BUSY_BODY, UPTIME_SSE } from "@/lib/chat/fixtures";
import { openDb } from "@/server/db/client";

import { Chat, expensiveWarning, imageHash, RICH_HINT, toModels, whoLine } from "./chat";
import { HermesApiServer } from "./hermes-api";
import { argsPreview, splitImages, toHistory, toItems, toolOutcome } from "./history";
import { controlRequest, eventsRequest, startRequest } from "./http";
import { autoTitle, ChatStore } from "./store";
import { cleanTitle, titlePrompt } from "./titler";

const KEY = "sk-test-hermes-api-server-key";
const ADMIN = { email: "admin@example.com", role: "admin" as const };
const OTHER = { email: "other@example.com", role: "admin" as const };
const MEMBER = { email: "member@example.com", role: "member" as const };

const OPTIONS = {
  model: "big-model",
  provider: "acme",
  providers: [
    { slug: "acme", name: "Acme", authenticated: true, models: ["big-model", "small-model", "pricey"], capabilities: { "big-model": { reasoning: true }, "small-model": { reasoning: false } }, pricing: { pricey: { input: "30", output: "150" } } },
    { slug: "other", name: "Other", authenticated: false, models: ["x"] },
  ],
};

// 1×1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Call = { method: string; path: string; body: unknown; headers: Record<string, string>; signal?: AbortSignal | null };

function fakeHermes(overrides: Partial<Record<string, (call: Call) => Response | Promise<Response>>> = {}) {
  const calls: Call[] = [];
  const sessions = new Map<string, unknown[]>();
  let n = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const call: Call = { method: init?.method ?? "GET", path: u.pathname + u.search, body: init?.body ? JSON.parse(String(init.body)) : null, headers: (init?.headers as Record<string, string>) ?? {}, signal: init?.signal };
    calls.push(call);
    const key = `${call.method} ${u.pathname}`;
    const override = Object.entries(overrides).find(([pattern]) => new RegExp(`^${pattern}$`).test(key));
    if (override) return override[1]!(call);
    if (key === "GET /api/model/options") return json(OPTIONS);
    if (key === "POST /api/sessions") {
      const id = `api_test_${++n}`;
      sessions.set(id, []);
      return json({ session: { id, title: (call.body as { title: string }).title } }, 201);
    }
    if (/^GET \/api\/sessions\/[^/]+\/messages$/.test(key)) return json({ data: sessions.get(u.pathname.split("/")[3]!) ?? [] });
    if (/^GET \/api\/sessions\/[^/]+$/.test(key)) return json({ session: { id: u.pathname.split("/")[3], title: null } });
    if (/^(PATCH|DELETE) \/api\/sessions\/[^/]+$/.test(key)) return json({ ok: true });
    if (key === "POST /v1/runs") return json({ run_id: `run_${String(++n).padStart(8, "0")}`, status: "started" }, 202);
    if (/^GET \/v1\/runs\/[^/]+$/.test(key)) return json({ status: "running" });
    if (/^GET \/v1\/runs\/[^/]+\/events$/.test(key)) return new Response(UPTIME_SSE, { headers: { "Content-Type": "text/event-stream" } });
    if (/^POST \/v1\/runs\/[^/]+\/(stop|approval|clarify)$/.test(key)) return json({ status: "ok" });
    return json({ error: { message: "nope" } }, 404);
  }) as typeof fetch;
  return { calls, sessions, fetcher };
}

function setup(overrides?: Parameters<typeof fakeHermes>[0]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-"));
  const db = openDb(dir);
  const hermes = fakeHermes(overrides);
  const store = new ChatStore(db);
  const chat = new Chat(new HermesApiServer("http://hermes.test", KEY, hermes.fetcher), store);
  return { chat, store, hermes, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const post = (body: unknown) => new Request("http://hub.test/api/hermes-chat/runs", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

async function readAll(response: Response) {
  return await response.text();
}

describe("chat archives", () => {
  it("archiving takes a conversation out of the unread answers, only for its owner, and a new message brings it back", async () => {
    const t = setup({ "GET /v1/runs/[^/]+": () => new Response(JSON.stringify({ status: "completed" }), { headers: { "Content-Type": "application/json" } }) });
    const started = await t.chat.start(ADMIN, { conversationId: null, text: "Rapport", images: [], choice: null, mode: "send" });
    await t.chat.watchOnce();
    expect(t.store.unread("admin@example.com")).toHaveLength(1);
    t.store.setArchived(started.conversationId, "other@example.com", true);
    expect(t.store.list("admin@example.com")[0]!.archivedAt).toBeNull();
    t.store.setArchived(started.conversationId, "admin@example.com", true);
    expect(t.store.list("admin@example.com")[0]!.archivedAt).toBeGreaterThan(0);
    expect(t.store.unread("admin@example.com")).toEqual([]);
    await t.chat.start(ADMIN, { conversationId: started.conversationId, text: "Encore", images: [], choice: null, mode: "send" });
    expect(t.store.list("admin@example.com")[0]!.archivedAt).toBeNull();
    t.cleanup();
  });
});

describe("chat unread answers", () => {
  it("a run ended while nobody follows it becomes unread for its owner only, until they look; a stop is not news", async () => {
    let status = "running";
    const t = setup({ "GET /v1/runs/[^/]+": () => new Response(JSON.stringify({ status }), { headers: { "Content-Type": "application/json" } }) });
    let now = 1_000_000;
    const store = new ChatStore((t.store as unknown as { db: never }).db, () => now);
    const chat = new Chat(t.chat.api, store, () => now);
    const started = await chat.start(ADMIN, { conversationId: null, text: "Fais le rapport", images: [], choice: null, mode: "send" });
    now += 60_000;
    await chat.watchOnce();
    expect(store.unread("admin@example.com")).toEqual([]);
    expect(store.list("admin@example.com")[0]).toMatchObject({ running: true, unread: false });
    status = "completed";
    now += 60_000;
    await chat.watchOnce();
    expect(store.unread("admin@example.com")).toEqual([{ id: started.conversationId, title: "Fais le rapport", endedAt: now, status: "completed" }]);
    expect(store.list("admin@example.com")[0]).toMatchObject({ running: false, unread: true });
    expect(store.unread("other@example.com")).toEqual([]);
    // Someone else cannot mark it read.
    store.markSeen(started.conversationId, "other@example.com");
    expect(store.unread("admin@example.com")).toHaveLength(1);
    now += 1_000;
    store.markSeen(started.conversationId, "admin@example.com");
    expect(store.unread("admin@example.com")).toEqual([]);
    // The next answer, stopped by the person: no alert.
    status = "running";
    const again = await chat.start(ADMIN, { conversationId: started.conversationId, text: "Encore", images: [], choice: null, mode: "send" });
    now += 1_000;
    store.endRun(again.runId, "cancelled");
    expect(store.unread("admin@example.com")).toEqual([]);
    t.cleanup();
  });
});

describe("chat routes", () => {
  it("refuses members everywhere (403) and never reaches Hermes", async () => {
    const t = setup();
    expect((await startRequest(MEMBER, post({ text: "salut" }), t.chat)).status).toBe(403);
    expect((await eventsRequest(MEMBER, new Request("http://hub.test/x"), "run_00000001", t.chat)).status).toBe(403);
    expect((await controlRequest(MEMBER, new Request("http://hub.test/x", { method: "POST" }), "run_00000001", "stop", t.chat)).status).toBe(403);
    expect(t.hermes.calls).toEqual([]);
    t.cleanup();
  });

  it("refuses a POST another site could send (not JSON, cross-site, foreign origin)", async () => {
    const t = setup();
    const send = (headers: Record<string, string>) => startRequest(ADMIN, new Request("http://hub.test/api/hermes-chat/runs", { method: "POST", headers, body: '{"text":"x"}' }), t.chat);
    expect((await send({ "Content-Type": "text/plain" })).status).toBe(403);
    expect((await send({ ...JSON_HEADERS, "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await send({ ...JSON_HEADERS, "Sec-Fetch-Site": "same-site" })).status).toBe(403);
    expect((await send({ ...JSON_HEADERS, Origin: "https://evil.example.com", Host: "hub.test" })).status).toBe(403);
    expect(t.hermes.calls).toEqual([]);
    expect((await send({ ...JSON_HEADERS, "Sec-Fetch-Site": "same-origin", Origin: "https://hub.test", Host: "hub.test" })).status).toBe(201);
    t.cleanup();
  });

  it("starts a run in a new session with who is talking and the memory key, and never answers the key", async () => {
    const t = setup();
    const response = await startRequest(ADMIN, post({ text: "Réponds juste OK", choice: { provider: "acme", model: "small-model", reasoning: "high" } }), t.chat);
    const text = await response.text();
    expect(response.status).toBe(201);
    expect(text).not.toContain(KEY);
    const started = JSON.parse(text);
    expect(started).toMatchObject({ title: "Réponds juste OK", model: "small-model" });
    const run = t.hermes.calls.find((c) => c.path === "/v1/runs")!;
    expect(run.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(run.headers["X-Hermes-Session-Key"]).toBe("dashboard:admin@example.com");
    // small-model takes no reasoning level: none is sent.
    expect(run.body).toEqual({ input: "Réponds juste OK", session_id: "api_test_1", instructions: `${whoLine(ADMIN)}\n\n${RICH_HINT}`, model: "small-model", provider: "acme" });
    expect(t.store.list("admin@example.com")).toMatchObject([{ id: started.conversationId, title: "Réponds juste OK", running: true }]);
    // Somebody else does not see it, nor reach it.
    expect(t.store.list("other@example.com")).toEqual([]);
    expect((await startRequest(OTHER, post({ conversationId: started.conversationId, text: "x" }), t.chat)).status).toBe(404);
    t.cleanup();
  });

  it("sends the reasoning level and images inline, keeping a thumbnail by Hermes's hash", async () => {
    const t = setup();
    const response = await startRequest(ADMIN, post({ text: "Décris", images: [{ data: PNG, thumb: PNG }], choice: { provider: "acme", model: "big-model", reasoning: "none" } }), t.chat);
    expect(response.status).toBe(201);
    const run = t.hermes.calls.find((c) => c.path === "/v1/runs")!;
    expect(run.body).toMatchObject({
      input: [{ role: "user", content: [{ type: "text", text: "Décris" }, { type: "image_url", image_url: { url: PNG } }] }],
      model_options: { reasoning: { enabled: false } },
    });
    expect(t.store.thumbs("admin@example.com", [imageHash(PNG)]).get(imageHash(PNG))).toBe(PNG);
    t.cleanup();
  });

  it("refuses a model Hermes does not offer, a non-image and too many images", async () => {
    const t = setup();
    const bad = async (body: unknown) => {
      const r = await startRequest(ADMIN, post(body), t.chat);
      return [r.status, (await r.json()).error.message];
    };
    expect(await bad({ text: "x", choice: { provider: "other", model: "x" } })).toEqual([400, "This model is not available in Hermes."]);
    expect((await bad({ text: "x", images: [{ data: "data:text/plain;base64,aGk=", thumb: PNG }] }))[0]).toBe(400);
    expect((await bad({ text: "x", images: Array(5).fill({ data: PNG, thumb: PNG }) }))[0]).toBe(400);
    expect(t.hermes.calls.some((c) => c.path === "/v1/runs")).toBe(false);
    t.cleanup();
  });

  it("says Hermes is busy (429) or stopped (503), in plain words", async () => {
    const busy = setup({ "POST /v1/runs": () => new Response(JSON.stringify(BUSY_BODY), { status: 429 }) });
    const r = await startRequest(ADMIN, post({ text: "x" }), busy.chat);
    expect(r.status).toBe(429);
    expect((await r.json()).error.message).toMatch(/too many answers/);
    busy.cleanup();
    const down = setup({ ".*": () => Promise.reject(new TypeError("fetch failed")) });
    const d = await startRequest(ADMIN, post({ text: "x" }), down.chat);
    expect(d.status).toBe(503);
    expect((await d.json()).error.message).toMatch(/Hermes does not answer/);
    down.cleanup();
  });

  it("says Hermes refused the image when it answers 400", async () => {
    const t = setup({ "POST /v1/runs": () => new Response(JSON.stringify({ error: { message: "invalid_params", code: "invalid_params" } }), { status: 400 }) });
    const r = await startRequest(ADMIN, post({ text: "x", images: [{ data: PNG, thumb: PNG }] }), t.chat);
    expect(r.status).toBe(400);
    expect((await r.json()).error.message).toMatch(/refused the image/);
    t.cleanup();
  });

  it("relays the events as SSE with no-buffer headers and ends the run in the store", async () => {
    const t = setup();
    const { runId, conversationId } = await (await startRequest(ADMIN, post({ text: "uptime" }), t.chat)).json();
    const response = await eventsRequest(ADMIN, new Request(`http://hub.test/api/hermes-chat/runs/${runId}/events?after=1`), runId, t.chat);
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const body = await readAll(response);
    expect(body).toContain('"event":"run.completed"');
    expect(body).not.toContain(KEY);
    expect(t.hermes.calls.find((c) => c.path.endsWith("/events"))!.headers["Last-Event-ID"]).toBe("1");
    expect(t.store.run(runId, "admin@example.com")?.status).toBe("completed");
    expect(t.store.list("admin@example.com")[0]).toMatchObject({ id: conversationId, running: false });
    // Another person cannot read it.
    expect((await eventsRequest(OTHER, new Request("http://hub.test/x"), runId, t.chat)).status).toBe(404);
    t.cleanup();
  });

  it("keeps Hermes's latest wait estimate on the run, shown in the list and to a page opened later; else the usual duration", async () => {
    const sse = [
      { event: "message.delta", delta: "⏱️ Estimation : ~1", seq: 0 },
      { event: "message.delta", delta: "0 min\n\nJe lance le build.", seq: 1 },
      { event: "tool.started", tool: "terminal", preview: "build", tool_call_id: "t1", seq: 2 },
      { event: "message.delta", delta: "\n⏱️ Plus que ~2 min\n", seq: 3 },
    ]
      .map((e) => `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`)
      .join("");
    const t = setup({ "GET /v1/runs/[^/]+/events": () => new Response(sse, { headers: { "Content-Type": "text/event-stream" } }) });
    let now = 5_000_000;
    const store = new ChatStore((t.store as unknown as { db: never }).db, () => now);
    const chat = new Chat(t.chat.api, store, () => now);
    // No estimate and no earlier answer: nothing to show.
    const first = await chat.start(ADMIN, { conversationId: null, text: "Rapide", images: [], choice: null, mode: "send" });
    expect(store.list("admin@example.com")[0]).toMatchObject({ running: true, eta: null, startedAt: now });
    now += 40_000;
    store.endRun(first.runId, "completed");
    // The next one: the usual duration (40 s) until Hermes says otherwise.
    now += 1_000;
    const { runId, conversationId } = await chat.start(ADMIN, { conversationId: first.conversationId, text: "Déploie", images: [], choice: null, mode: "send" });
    const started = now;
    expect(store.list("admin@example.com")[0]).toMatchObject({ running: true, startedAt: started, eta: { seconds: 40, at: started, estimated: true } });
    now += 5_000;
    await readAll(await eventsRequest(ADMIN, new Request(`http://hub.test/x`), runId, chat));
    expect(store.run(runId, "admin@example.com")).toMatchObject({ etaSeconds: 120, etaAt: now });
    expect(store.list("admin@example.com")[0]!.eta).toEqual({ seconds: 120, at: now });
    const thread = await chat.thread(ADMIN, conversationId);
    expect(thread.active).toMatchObject({ id: runId, eta: { seconds: 120, at: now } });
    // Over: no countdown any more.
    store.endRun(runId, "completed");
    expect(store.list("admin@example.com")[0]).toMatchObject({ running: false });
    expect(store.list("admin@example.com")[0]!.eta).toBeUndefined();
    t.cleanup();
  });

  it("asks Hermes for the countdown lines", () => {
    expect(RICH_HINT).toContain("⏱️ Estimate: ~N min");
    expect(RICH_HINT).toContain("⏱️ ~N min left");
  });

  it("a browser that leaves only detaches: the upstream stream is aborted, the run is never stopped", async () => {
    let upstreamSignal: AbortSignal | null | undefined;
    const t = setup({
      "GET /v1/runs/[^/]+/events": (call) => {
        upstreamSignal = call.signal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('id: 0\ndata: {"event":"message.delta","delta":"Bon","seq":0}\n\n'));
            call.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });
    const { runId } = await (await startRequest(ADMIN, post({ text: "long" }), t.chat)).json();
    const browser = new AbortController();
    const response = await eventsRequest(ADMIN, new Request("http://hub.test/x", { signal: browser.signal }), runId, t.chat);
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain(": open");
    browser.abort();
    await reader.cancel().catch(() => {});
    expect(upstreamSignal?.aborted).toBe(true);
    expect(t.hermes.calls.some((c) => c.path.endsWith("/stop"))).toBe(false);
    expect(t.store.run(runId, "admin@example.com")?.status).toBe("running");
    t.cleanup();
  });

  it("when Hermes no longer streams a finished run, sends its final status as one event", async () => {
    const t = setup({
      "GET /v1/runs/[^/]+/events": () => new Response(JSON.stringify({ error: { message: "Run not found" } }), { status: 404 }),
      "GET /v1/runs/[^/]+": () => new Response(JSON.stringify({ status: "failed", error: "boom" })),
    });
    const { runId } = await (await startRequest(ADMIN, post({ text: "x" }), t.chat)).json();
    const body = await readAll(await eventsRequest(ADMIN, new Request("http://hub.test/x"), runId, t.chat));
    expect(body).toContain('"event":"run.failed"');
    expect(t.store.run(runId, "admin@example.com")?.status).toBe("failed");
    t.cleanup();
  });

  it("a run Hermes no longer streams but still runs is not ended; one Hermes forgot is read from the history", async () => {
    const running = setup({ "GET /v1/runs/[^/]+/events": () => new Response("{}", { status: 404 }) });
    const { runId } = await (await startRequest(ADMIN, post({ text: "x" }), running.chat)).json();
    const quiet = await readAll(await eventsRequest(ADMIN, new Request("http://hub.test/x"), runId, running.chat));
    expect(quiet).not.toContain("data:");
    expect(running.store.run(runId, "admin@example.com")?.status).toBe("running");
    running.cleanup();

    const forgotten = setup({ "GET /v1/runs/[^/]+(/events)?": () => new Response("{}", { status: 404 }) });
    const started = await (await startRequest(ADMIN, post({ text: "x" }), forgotten.chat)).json();
    forgotten.hermes.sessions.set("api_test_1", [
      { id: 1, role: "user", content: "x", timestamp: Date.now() / 1000 },
      { id: 2, role: "assistant", content: "Fini.", timestamp: Date.now() / 1000 + 1 },
    ]);
    const body = await readAll(await eventsRequest(ADMIN, new Request("http://hub.test/x"), started.runId, forgotten.chat));
    expect(body).toContain('"event":"run.completed"');
    expect(body).toContain('"output":"Fini."');
    expect(forgotten.store.run(started.runId, "admin@example.com")?.status).toBe("completed");
    forgotten.cleanup();
  });

  it("stop, approval and clarify reach the run with Hermes's exact identity", async () => {
    const t = setup();
    const { runId } = await (await startRequest(ADMIN, post({ text: "x" }), t.chat)).json();
    const req = (body: unknown) => new Request("http://hub.test/x", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    expect((await controlRequest(ADMIN, req({}), runId, "stop", t.chat)).status).toBe(200);
    expect((await controlRequest(ADMIN, req({ promptId: "prm_1", generation: 3, choice: "once" }), runId, "approval", t.chat)).status).toBe(200);
    expect((await controlRequest(ADMIN, req({ promptId: "clr_1", generation: 2, answer: "Hier" }), runId, "clarify", t.chat)).status).toBe(200);
    expect((await controlRequest(ADMIN, req({ promptId: "prm_1", generation: 3, choice: "always" }), runId, "approval", t.chat)).status).toBe(400);
    expect(t.hermes.calls.filter((c) => c.method === "POST" && c.path.startsWith(`/v1/runs/${runId}/`)).map((c) => [c.path.split("/").pop(), c.body])).toEqual([
      ["stop", {}],
      ["approval", { request_id: "prm_1", execution_generation: 3, choice: "once" }],
      ["clarify", { request_id: "clr_1", execution_generation: 2, answer: "Hier" }],
    ]);
    t.cleanup();
  });

  it("refuses a second message while Hermes still answers", async () => {
    const t = setup();
    const { conversationId } = await (await startRequest(ADMIN, post({ text: "x" }), t.chat)).json();
    expect((await startRequest(ADMIN, post({ conversationId, text: "y" }), t.chat)).status).toBe(409);
    t.cleanup();
  });

  it("regenerates in a new session, sending the earlier turns back and deleting the old session", async () => {
    const t = setup({ "GET /v1/runs/[^/]+": () => new Response(JSON.stringify({ status: "completed" })) });
    const { conversationId } = await (await startRequest(ADMIN, post({ text: "Premier" }), t.chat)).json();
    t.hermes.sessions.set("api_test_1", [
      { id: 1, role: "user", content: "Premier", timestamp: 1 },
      { id: 2, role: "assistant", content: "Réponse 1", timestamp: 2 },
      { id: 3, role: "user", content: "Second", timestamp: 3 },
      { id: 4, role: "assistant", content: "Mauvaise réponse", timestamp: 4 },
    ]);
    const r = await startRequest(ADMIN, post({ conversationId, mode: "regenerate" }), t.chat);
    expect(r.status).toBe(201);
    const run = t.hermes.calls.filter((c) => c.path === "/v1/runs").pop()!;
    expect(run.body).toMatchObject({ input: "Second", session_id: "api_test_3", conversation_history: [{ role: "user", content: "Premier" }, { role: "assistant", content: "Réponse 1" }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.hermes.calls.some((c) => c.method === "DELETE" && c.path === "/api/sessions/api_test_1")).toBe(true);
    // The thread still shows the kept turns, then the new session's.
    t.hermes.sessions.set("api_test_3", [{ id: 9, role: "user", content: "Second", timestamp: 5 }, { id: 10, role: "assistant", content: "Meilleure", timestamp: 6 }]);
    const thread = await t.chat.thread(ADMIN, conversationId);
    expect(thread.items.map((i) => (i.role === "user" ? i.text : i.parts.map((p) => (p.kind === "text" ? p.text : p.kind)).join()))).toEqual(["Premier", "Réponse 1", "Second", "Meilleure"]);
    t.cleanup();
  });

  it("a refused regenerate leaves the conversation as it was", async () => {
    let refuse = false;
    const t = setup({
      "GET /v1/runs/[^/]+": () => new Response(JSON.stringify({ status: "completed" })),
      "POST /v1/runs": () => (refuse ? new Response(JSON.stringify(BUSY_BODY), { status: 429 }) : new Response(JSON.stringify({ run_id: "run_aaaaaaaa" }), { status: 202 })),
    });
    const { conversationId } = await (await startRequest(ADMIN, post({ text: "Premier" }), t.chat)).json();
    t.hermes.sessions.set("api_test_1", [{ id: 1, role: "user", content: "Premier", timestamp: 1 }, { id: 2, role: "assistant", content: "R", timestamp: 2 }]);
    refuse = true;
    expect((await startRequest(ADMIN, post({ conversationId, mode: "regenerate" }), t.chat)).status).toBe(429);
    expect(t.store.get(conversationId, "admin@example.com")).toMatchObject({ sessionId: "api_test_1", carry: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The session made for it is dropped; the old one stays.
    expect(t.hermes.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/api/sessions/api_test_2"]);
    // A refused first message leaves no empty conversation behind.
    expect((await startRequest(ADMIN, post({ text: "Nouveau" }), t.chat)).status).toBe(429);
    expect(t.store.list("admin@example.com")).toHaveLength(1);
    t.cleanup();
  });

  it("history sent back to Hermes keeps what the tools said, in the assistant's text", () => {
    expect(
      toHistory([
        { role: "user", content: "Charge ?" },
        { role: "assistant", content: "Je regarde.", tool_calls: [{ id: "t1", type: "function", function: { name: "terminal", arguments: '{"command":"uptime"}' } }] },
        { role: "tool", tool_call_id: "t1", content: '{"output": "load 0.2", "exit_code": 0}' },
        { role: "assistant", content: "Faible." },
      ]),
    ).toEqual([
      { role: "user", content: "Charge ?" },
      { role: "assistant", content: "Je regarde.\n[Tool terminal: uptime → load 0.2]\n\nFaible." },
    ]);
  });

  it("does not show another person's chat session read only", async () => {
    const t = setup({ "GET /v1/runs/[^/]+": () => new Response(JSON.stringify({ status: "completed" })) });
    await startRequest(ADMIN, post({ text: "secret" }), t.chat);
    await expect(t.chat.readSession(OTHER, "api_test_1")).rejects.toThrow(/does not exist/);
    expect(await t.chat.readSession(ADMIN, "api_test_1")).toMatchObject({ conversationId: expect.stringMatching(/^c_/) });
    t.cleanup();
  });

  it("renames and deletes only the owner's conversations, with their Hermes sessions", async () => {
    const t = setup({ "GET /v1/runs/[^/]+": () => new Response(JSON.stringify({ status: "completed" })) });
    const { conversationId } = await (await startRequest(ADMIN, post({ text: "x" }), t.chat)).json();
    await expect(t.chat.rename(OTHER, conversationId, "pirate")).rejects.toThrow(/does not exist/);
    expect(await t.chat.rename(ADMIN, conversationId, "  [test agent]   Nouveau  ")).toEqual({ title: "[test agent] Nouveau" });
    expect(t.hermes.calls.find((c) => c.method === "PATCH")?.body).toEqual({ title: "[test agent] Nouveau" });
    await t.chat.remove(ADMIN, conversationId);
    expect(t.hermes.calls.some((c) => c.method === "DELETE" && c.path === "/api/sessions/api_test_1")).toBe(true);
    expect(t.store.list("admin@example.com")).toEqual([]);
    t.cleanup();
  });
});

describe("models", () => {
  it("lists connected providers' models, the main one first, with Hermes's expensive threshold", () => {
    const { current, models } = toModels(OPTIONS);
    expect(current).toEqual({ provider: "acme", model: "big-model" });
    expect(models.map((m) => [m.model, m.reasoning, Boolean(m.expensive)])).toEqual([
      ["big-model", true, false],
      ["small-model", false, false],
      ["pricey", false, true],
    ]);
    expect(expensiveWarning("m", { input: 5, output: 15 })).toBeNull();
    expect(expensiveWarning("m", undefined)).toBeNull();
    expect(expensiveWarning("m", { input: "3", output: "120" })).toMatch(/is expensive/);
  });
});

describe("history", () => {
  it("groups tool calls, results and the answer under one turn, and finds images by hash", () => {
    const hash = "a229b93365a8c144dd6a84569c519deb";
    const items = toItems(
      [
        { id: 1, role: "user", content: `Quelle couleur ?\n\n[Image attached at: /root/.hermes/cache/x/api_${hash}.png]\n[screenshot]`, timestamp: 10 },
        { id: 2, role: "assistant", content: "Je regarde.", tool_calls: [{ id: "t1", type: "function", function: { name: "terminal", arguments: '{"command":"uptime"}' } }], timestamp: 11 },
        { id: 3, role: "tool", tool_call_id: "t1", tool_name: "terminal", content: '{"output": "up 5 days", "exit_code": 0, "error": null}', timestamp: 12 },
        { id: 4, role: "assistant", content: "Rouge.", timestamp: 13 },
      ],
      { thumb: (h) => (h === hash ? "data:thumb" : ""), modelAt: () => "small-model" },
    );
    expect(items).toEqual([
      { role: "user", id: "u-1", text: "Quelle couleur ?", images: ["data:thumb"], at: 10_000 },
      {
        role: "assistant",
        id: "a-2",
        model: "small-model",
        at: 13_000,
        parts: [
          { kind: "text", text: "Je regarde." },
          { kind: "tool", id: "t1", name: "terminal", preview: "uptime", status: "done", result: "up 5 days" },
          { kind: "text", text: "Rouge." },
        ],
      },
    ]);
  });

  it("reads tool failures and argument previews", () => {
    expect(toolOutcome('{"output": "", "exit_code": 2, "error": null}').failed).toBe(true);
    expect(toolOutcome("BLOCKED: refused by the user").failed).toBe(true);
    expect(toolOutcome('{"output": "ok"}')).toEqual({ failed: false, summary: "ok" });
    expect(argsPreview('{"path": "/etc/hosts", "limit": 5}')).toBe("/etc/hosts");
    expect(splitImages("Sans image")).toEqual({ text: "Sans image", hashes: [] });
  });

  it("titles a conversation with its first words", () => {
    expect(autoTitle("  Résume les ventes   d'hier ")).toBe("Résume les ventes d'hier");
    expect(autoTitle("Peux-tu me donner la liste complète des appels de la semaine dernière avec leur analyse")).toBe("Peux-tu me donner la liste complète des appels de la…");
  });
});

describe("smart titles", () => {
  const completed = { "GET /v1/runs/[^/]+": () => new Response(JSON.stringify({ status: "completed" }), { headers: { "Content-Type": "application/json" } }) };

  it("cleans the model's line", () => {
    expect(cleanTitle("« Renommer les conversations du Chat ».\n")).toBe("Renommer les conversations du Chat");
    expect(cleanTitle("Titre : Titres intelligents du Chat")).toBe("Titres intelligents du Chat");
    expect(cleanTitle("  ")).toBeNull();
    expect(cleanTitle("a".repeat(30) + " " + "b".repeat(60))!.length).toBeLessThanOrEqual(71);
  });

  it("gives the model the person's messages and the start of the answers", () => {
    const prompt = titlePrompt({ questions: ["Je veux renommer mes chats", "Et un titre auto ?"], answers: ["Oui, c'est faisable", "Fait"] });
    expect(prompt).toContain("Message 1 from the person: Je veux renommer mes chats");
    expect(prompt).toContain("Start of Hermes's first answer: Oui, c'est faisable");
    expect(prompt).toContain("Start of Hermes's last answer: Fait");
  });

  it("titles after the first answer, again after the third, and never over a title the person typed", async () => {
    const t = setup(completed);
    const prompts: string[] = [];
    let n = 0;
    const chat = new Chat(t.chat.api, t.store, Date.now, async (_s, prompt) => (prompts.push(prompt), `Titre ${++n}`));
    const started = await chat.start(ADMIN, { conversationId: null, text: "Peux-tu me donner la liste complète des appels de la semaine dernière avec leur analyse", images: [], choice: null, mode: "send" });
    await chat.watchOnce();
    await chat.titleOnce();
    expect(t.store.get(started.conversationId, "admin@example.com")!.title).toBe("Titre 1");
    expect(prompts[0]).toContain("liste complète des appels");
    await chat.titleOnce();
    expect(n).toBe(1);
    for (const text of ["Et les closers ?", "Et Mel ?"]) {
      await chat.start(ADMIN, { conversationId: started.conversationId, text, images: [], choice: null, mode: "send" });
      await chat.watchOnce();
      await chat.titleOnce();
    }
    expect(t.store.get(started.conversationId, "admin@example.com")).toMatchObject({ title: "Titre 2", titleSource: "ai2" });
    await chat.titleOnce();
    expect(n).toBe(2);
    expect(t.hermes.calls.some((c) => c.method === "PATCH" && (c.body as { title?: string } | null)?.title === "Titre 2")).toBe(true);

    const other = await chat.start(ADMIN, { conversationId: null, text: "Autre chose", images: [], choice: null, mode: "send" });
    await chat.rename(ADMIN, other.conversationId, "Mon titre");
    await chat.watchOnce();
    await chat.titleOnce();
    expect(t.store.get(other.conversationId, "admin@example.com")!.title).toBe("Mon titre");
    t.cleanup();
  });
});
