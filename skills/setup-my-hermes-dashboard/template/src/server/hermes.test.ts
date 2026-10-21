import { describe, expect, it } from "vitest";

import { Hermes, HermesError, toMs } from "./hermes";

/** A fake Hermes: serves its page with the current session token and checks it on every API call. */
function fakeHermes() {
  const state = { token: "first", pageReads: 0 };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const sent = new Headers(init?.headers).get("X-Hermes-Session-Token");
    if (url.pathname === "/") {
      state.pageReads++;
      return new Response(`<script>window.__HERMES_SESSION_TOKEN__="${state.token}";</script>`, { status: 200 });
    }
    if (url.pathname === "/api/status") return Response.json({ version: "1.2.3", overall: "ok", gateway_running: true, gateway_platforms: { telegram: {} } });
    if (sent !== state.token) return new Response("unauthorized", { status: 401 });
    if (url.pathname === "/api/cron/jobs") {
      return Response.json([{ id: "c1", name: "Morning brief", schedule: { display: "0 8 * * *" }, last_status: "ok", next_run_at: 1_800_000_000 }]);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { state, fetcher };
}

describe("Hermes client", () => {
  it("reads the status without a token", async () => {
    const { state, fetcher } = fakeHermes();
    const status = await new Hermes("http://hermes.test", null, fetcher).status();
    expect(status).toMatchObject({ version: "1.2.3", gatewayRunning: true, platforms: ["telegram"] });
    expect(state.pageReads).toBe(0);
  });

  it("reads the token from the page once, then again after Hermes restarts", async () => {
    const { state, fetcher } = fakeHermes();
    const hermes = new Hermes("http://hermes.test", null, fetcher);
    const [cron] = await hermes.api<{ name: string }[]>("/api/cron/jobs");
    expect(cron).toMatchObject({ name: "Morning brief" });
    await hermes.api("/api/cron/jobs");
    expect(state.pageReads).toBe(1);
    state.token = "after-restart";
    await hermes.api("/api/cron/jobs");
    expect(state.pageReads).toBe(2);
  });

  it("fails cleanly when Hermes is down", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(new Hermes("http://hermes.test", null, down).api("/api/cron/jobs")).rejects.toBeInstanceOf(HermesError);
  });

  it("converts Hermes times to milliseconds", () => {
    expect(toMs(1_800_000_000.5)).toBe(1_800_000_000_500);
    expect(toMs("2026-10-21T00:00:00Z")).toBe(Date.parse("2026-10-21T00:00:00Z"));
    expect(toMs(null)).toBeNull();
  });
});
