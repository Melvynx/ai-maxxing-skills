import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { openDb } from "@/server/db/client";
import type { HermesStatus, Json } from "@/server/hermes";

import { AUDIT_NAME, InfraAudit, parseReport } from "./audit";
import { parseAptCheck, parseFailed, parseMeminfo, parsePublicPorts, parseSshd, parseUnits, parseUpdateCheck, runChecks, type CheckContext } from "./checks";
import { FixExistsError, InfraFixes } from "./fixes";
import { InfraHealth } from "./health";
import { worst } from "./model";
import type { RunResult, System } from "./system";

const dirs: string[] = [];
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infra-"));
  dirs.push(dir);
  return openDb(dir);
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const ok = (stdout: string, stderr = ""): RunResult => ({ code: 0, stdout, stderr });
const missing: RunResult = { code: 127, stdout: "", stderr: "not found" };

/** A healthy Ubuntu server, in the outputs its commands print. Each test changes what it needs. */
function fakeSystem(overrides: { commands?: Record<string, RunResult>; files?: Record<string, string>; free?: number } = {}) {
  const calls: { command: string; args: string[]; input?: string }[] = [];
  const commands: Record<string, RunResult> = {
    "systemctl show": ok(["caddy", "vps-gate", "vps-tunnel", "hermes-dashboard"].map((u) => `Id=${u}.service\nLoadState=loaded\nActiveState=active\nSubState=running`).join("\n\n")),
    "systemctl --failed": ok(""),
    "systemctl restart": ok(""),
    "systemctl is-active": ok("active\n"),
    "hermes update": ok("✓ Already up to date.\n"),
    "/usr/lib/update-notifier/apt-check": ok("", "12;0"),
    journalctl: ok(""),
    sshd: ok("port 22\npermitrootlogin prohibit-password\npasswordauthentication no\n"),
    ufw: ok("Status: active\n"),
    ss: ok("LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*\nLISTEN 0 4096 127.0.0.1:8794 0.0.0.0:*\n"),
    ...overrides.commands,
  };
  const files: Record<string, string> = {
    "/proc/meminfo": "MemTotal:       8000000 kB\nMemFree:  1000000 kB\nMemAvailable:   4000000 kB\n",
    "/proc/loadavg": "0.20 0.30 0.25 1/200 1234\n",
    "/proc/uptime": "864000.12 1000.00\n",
    ...overrides.files,
  };
  let clock = 1_800_000_000_000;
  const system: System = {
    async run(command, args, options) {
      calls.push({ command, args, input: options?.input });
      const name = path.basename(command);
      return commands[`${name} ${args[0]}`] ?? commands[command] ?? commands[name] ?? missing;
    },
    read: async (file) => files[file] ?? null,
    list: async (dir) => Object.keys(files).filter((file) => path.dirname(file) === dir).map((file) => path.basename(file)),
    exists: async (file) => file in files,
    disk: async () => ({ total: 100 * 1024 ** 3, free: (overrides.free ?? 60) * 1024 ** 3 }),
    cpus: () => 2,
    now: () => clock,
  };
  return { system, calls, files, advance: (ms: number) => (clock += ms) };
}

const STATUS: HermesStatus = { version: "0.22.2", overall: "ok", gatewayRunning: true, platforms: ["telegram"], activeSessions: 0, disk: null };

function fakeHermes(jobs: Json[] = [], status: HermesStatus | null = STATUS) {
  const sent: { method: string; path: string; body?: unknown }[] = [];
  return {
    sent,
    jobs,
    status: async () => {
      if (!status) throw new Error("down");
      return status;
    },
    api: async <T,>(url: string): Promise<T> => {
      if (url === "/api/cron/jobs") return jobs as T;
      if (url === "/api/cron/delivery-targets") return { targets: [{ id: "local" }, { id: "bot-chat:default", home_target_set: true }, { id: "telegram", home_target_set: true }] } as T;
      throw new Error(`unexpected ${url}`);
    },
    send: async <T,>(method: "POST" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> => {
      sent.push({ method, path: url, body });
      if (url === "/api/cron/jobs") jobs.push({ id: "job1", name: (body as Json).name, enabled: true, schedule: { display: "0 7 * * *" } });
      return {} as T;
    },
  };
}

function context(system: System, hermes = fakeHermes()): CheckContext {
  return { system, hermes, hermesBin: "/root/.local/bin/hermes", cached: (_key, _ttl, load) => load(), restart: async () => true };
}

const byId = (checks: { id: string }[], id: string) => checks.find((check) => check.id === id) as ReturnType<typeof Object> & { tone: string; summary: string; fix?: { key: string; prompt: string }; autoFixed?: string };

describe("infra readers", () => {
  it("read the outputs of the system commands", () => {
    expect(parseMeminfo("MemTotal: 1000 kB\nMemAvailable: 250 kB")).toEqual({ total: 1000, available: 250 });
    expect(parseMeminfo("nothing")).toBeNull();
    expect(parseUnits("Id=caddy.service\nLoadState=loaded\nActiveState=failed\nSubState=failed\n\nId=x.service\nLoadState=not-found\nActiveState=inactive\nSubState=dead")).toEqual([
      { id: "caddy", loaded: true, active: "failed", sub: "failed" },
      { id: "x", loaded: false, active: "inactive", sub: "dead" },
    ]);
    expect(parseFailed("backup.service loaded failed failed Backup\n")).toEqual(["backup"]);
    expect(parseSshd("port 2222\npermitrootlogin yes\npasswordauthentication yes")).toEqual({ password: true, rootLogin: "yes", port: 2222 });
    expect(parsePublicPorts("LISTEN 0 1 0.0.0.0:22 *\nLISTEN 0 1 [::]:3000 *\nLISTEN 0 1 127.0.0.53%lo:53 *\nLISTEN 0 1 [::1]:9180 *")).toEqual([22, 3000]);
    expect(parseAptCheck("5;2")).toEqual({ updates: 5, security: 2 });
    expect(parseUpdateCheck("Selected release available: stable v0.22.5 (2026-10-28)\nRun `hermes update`")).toEqual({ available: true, version: "0.22.5" });
    expect(parseUpdateCheck("✓ Already up to date.")).toEqual({ available: false, version: null });
    expect(worst(["good", "idle", "warn"])).toBe("warn");
    expect(worst(["idle"])).toBe("idle");
  });
});

describe("infra checks", () => {
  it("are all good on a healthy server", async () => {
    const { system } = fakeSystem();
    const checks = await runChecks(context(system));
    expect(checks).toHaveLength(14);
    expect(checks.filter((check) => check.tone !== "good").map((check) => check.id)).toEqual([]);
  });

  it("restart a stopped safe service and turn the rest into fix tasks", async () => {
    const { system } = fakeSystem({
      commands: {
        "systemctl show": ok("Id=caddy.service\nLoadState=loaded\nActiveState=failed\nSubState=failed"),
        sshd: ok("port 22\npermitrootlogin yes\npasswordauthentication yes"),
        ufw: ok("Status: inactive"),
        ss: ok("LISTEN 0 1 0.0.0.0:22 *\nLISTEN 0 1 0.0.0.0:9119 *"),
        "hermes update": ok("Selected release available: stable v0.22.5\nRun `hermes update` to install"),
      },
      files: { "/var/run/reboot-required": "*** System restart required ***", "/var/run/reboot-required.pkgs": "linux-base\n" },
      free: 5,
    });
    const checks = await runChecks(context(system));
    expect(byId(checks, "services.units")).toMatchObject({ tone: "good", autoFixed: "Restarted caddy" });
    expect(byId(checks, "server.disk")).toMatchObject({ tone: "bad", fix: { key: "health:server.disk" } });
    expect(byId(checks, "server.reboot").tone).toBe("warn");
    expect(byId(checks, "hermes.update").summary).toBe("Hermes 0.22.5 is available");
    expect(byId(checks, "security.ssh").fix?.prompt).toContain("Never open a port in the firewall");
    expect(byId(checks, "security.firewall").fix?.prompt).toContain("ufw allow 22/tcp");
    expect(byId(checks, "security.exposure").summary).toBe("Ports 9119 are reachable");
  });

  it("say when Hermes is down or the gateway stopped, without a fix task Hermes could not run", async () => {
    const { system } = fakeSystem();
    expect(byId(await runChecks(context(system, fakeHermes([], null))), "hermes.gateway")).toMatchObject({ tone: "bad", summary: "Hermes is not answering" });
    const stopped = byId(await runChecks(context(system, fakeHermes([], { ...STATUS, gatewayRunning: false }))), "hermes.gateway");
    expect(stopped).toMatchObject({ tone: "bad" });
    expect(stopped.fix).toBeUndefined();
  });

  it("count a cron as failing only after three failed runs in a row", async () => {
    const { system } = fakeSystem();
    const once = await runChecks(context(system, fakeHermes([{ id: "a", name: "brief", last_status: "error", failure_streak: 1 }])));
    expect(byId(once, "hermes.crons").tone).toBe("warn");
    const thrice = await runChecks(context(system, fakeHermes([{ id: "a", name: "brief", last_status: "error", failure_streak: 3 }])));
    expect(byId(thrice, "hermes.crons")).toMatchObject({ tone: "bad", fix: { key: "health:hermes.crons:brief" } });
  });

  it("stay quiet on a machine that is not a Linux server", async () => {
    const system: System = { ...fakeSystem().system, run: async () => missing, read: async () => null, exists: async () => false, disk: async () => null };
    const checks = await runChecks(context(system));
    expect(checks.filter((check) => check.category !== "hermes").every((check) => check.tone === "idle")).toBe(true);
  });
});

describe("infra health", () => {
  it("keeps the runs, gives one run to two callers and restarts a unit once an hour at most", async () => {
    const machine = fakeSystem({ commands: { "systemctl show": ok("Id=vps-gate.service\nLoadState=loaded\nActiveState=failed\nSubState=failed") } });
    const health = new InfraHealth(freshDb(), machine.system, fakeHermes(), "hermes");
    const [a, b] = await Promise.all([health.run(), health.run()]);
    expect(a).toBe(b);
    expect(health.latest()?.at).toBe(a.at);
    expect(await health.runIfStale()).toEqual(health.latest());

    machine.advance(15 * 60_000);
    await health.run();
    const restarts = machine.calls.filter((call) => call.command === "systemctl" && call.args[0] === "restart");
    expect(restarts).toHaveLength(1);
    expect(health.history().map((mark) => mark.tone)).toEqual(["good", "bad"]);
  });
});

describe("infra fixes", () => {
  it("sends a task to the Hermes board once per problem and follows it", async () => {
    const machine = fakeSystem({
      commands: {
        "hermes kanban": ok('{"id":"t_1","status":"todo"}'),
      },
    });
    const fixes = new InfraFixes(freshDb(), machine.system, "/root/.local/bin/hermes");
    const draft = { source: "health" as const, key: "health:server.disk", title: "Fix: free disk space", prompt: "Free some space please", actor: "ada@example.com" };
    const fix = await fixes.launch(draft);
    expect(fix).toMatchObject({ taskId: "t_1", status: "queued", actor: "ada@example.com" });
    const create = machine.calls.find((call) => call.args[0] === "kanban")!;
    expect(create.input).toBe("Free some space please");
    expect(create.args).toEqual(expect.arrayContaining(["--idempotency-key", "infra:health:server.disk", "--created-by", "dashboard:ada@example.com"]));

    await expect(fixes.launch(draft)).rejects.toBeInstanceOf(FixExistsError);
    expect((await fixes.launch({ ...draft, again: true })).taskId).toBe("t_1");

    machine.system.run = async () => ok('{"task":{"id":"t_1","status":"done","result":"Cleaned 4 GB of old logs"},"latest_summary":null}');
    await fixes.refresh();
    expect(fixes.list().map((item) => [item.status, item.note])).toEqual([
      ["done", "Cleaned 4 GB of old logs"],
      ["done", "Cleaned 4 GB of old logs"],
    ]);
  });

  it("keeps a failed task with the reason", async () => {
    const machine = fakeSystem({ commands: { "hermes kanban": { code: 1, stdout: "", stderr: "board locked" } } });
    const fix = await new InfraFixes(freshDb(), machine.system, "hermes").launch({ source: "audit", key: "audit:x", title: "Fix: x", prompt: "Do x now", actor: null });
    expect(fix).toMatchObject({ status: "failed", note: "board locked", taskId: null });
  });
});

const REPORT = `# Cron Job: infra-audit

## Prompt

Audit this server...

## Response

# Infra audit
**Verdict:** ATTENTION
Summary: The server runs fine but two settings should change.

## Server
- Up 10 days, a restart is pending.

## Security
- SSH accepts passwords.

## Exposure
- Only SSH is open.

## Not verified
- None

## Actions
- **P2** Plan a restart this week.
- **P0** Turn off SSH password login.
`;

describe("infra audit", () => {
  it("reads a report, actions sorted by priority", () => {
    const report = parseReport("2026-10-30_07-00-12.md", REPORT);
    expect(report).toMatchObject({ verdict: "attention", summary: "The server runs fine but two settings should change." });
    expect(report.at).toBe(new Date(2026, 9, 30, 7, 0, 12).getTime());
    expect(report.sections.map((section) => section.title)).toEqual(["Server", "Security", "Exposure", "Not verified"]);
    expect(report.actions.map((action) => [action.priority, action.text])).toEqual([
      ["P0", "Turn off SSH password login."],
      ["P2", "Plan a restart this week."],
    ]);
    expect(report.actions[0]!.fix.key).toBe("audit:turn-off-ssh-password-login");
    expect(parseReport("x.md", "Some free text").verdict).toBe("unknown");
  });

  it("creates the cron once, delivered to the chat with a home channel, and lists its reports", async () => {
    const machine = fakeSystem({ files: { "/h/cron/output/job1/2026-10-30_07-00-12.md": REPORT, "/h/cron/output/job1/2026-10-29_07-00-03.md": "## Response\nVerdict: OK" } });
    const hermes = fakeHermes();
    const audit = new InfraAudit(freshDb(), machine.system, hermes, "/h");
    await audit.seed();
    await audit.seed();
    expect(hermes.sent).toHaveLength(1);
    expect(hermes.sent[0]).toMatchObject({ method: "POST", path: "/api/cron/jobs", body: { name: AUDIT_NAME, schedule: "0 7 * * *", deliver: "telegram" } });

    // Deleted by the owner: it stays deleted.
    hermes.jobs.splice(0);
    await audit.seed();
    expect(await audit.job()).toBeNull();

    hermes.jobs.push({ id: "job1", name: AUDIT_NAME, enabled: true });
    expect((await audit.reports("job1")).map((report) => report.verdict)).toEqual(["attention", "ok"]);
  });
});
