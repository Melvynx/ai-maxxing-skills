import type { Hermes, HermesStatus, Json } from "@/server/hermes";

import type { Check, Tone } from "./model";
import { checkFix } from "./prompts";
import type { System } from "./system";

/**
 * The health checks. Each one reads the machine through `System` (or Hermes through its API) and returns a `Check`;
 * none of them changes anything, except `services`, which restarts a stopped unit of SAFE_RESTART on its own.
 * A check that cannot read what it needs (not Linux, not root, command missing) says so with the "idle" tone.
 */

export interface CheckContext {
  system: System;
  hermes: Pick<Hermes, "status" | "api">;
  hermesBin: string;
  /** Keeps slow answers (network, apt) for `ttlMs`. */
  cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
  /** Restarts a unit unless it was restarted less than an hour ago; true when it is running afterwards. */
  restart(unit: string): Promise<boolean>;
}

const HOUR = 3_600_000;
const GB = 1024 ** 3;

/** The units the setup installs. A unit that is not on this server is skipped. */
export const KEY_UNITS = ["caddy", "vps-gate", "vps-tunnel", "hermes-dashboard"];

/**
 * Units the dashboard may restart on its own: they hold no state and only come back the same. Never the Hermes
 * gateway (it may be mid-conversation), never the dashboard itself, never SSH.
 */
export const SAFE_RESTART = new Set(["caddy", "vps-gate", "vps-tunnel", "hermes-dashboard"]);

const idle = (base: Pick<Check, "id" | "category" | "title">, summary: string): Check => ({ ...base, tone: "idle", summary });

const percent = (value: number) => `${Math.round(value)}%`;

// ---------- Readers: pure, tested on sample outputs ----------

/** `/proc/meminfo` → total and available, in kB. */
export function parseMeminfo(text: string): { total: number; available: number } | null {
  const value = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? NaN);
  const total = value("MemTotal");
  const available = value("MemAvailable");
  return Number.isFinite(total) && Number.isFinite(available) && total > 0 ? { total, available } : null;
}

/** `/proc/loadavg` → the 1, 5 and 15 minute averages. */
export function parseLoadavg(text: string): [number, number, number] | null {
  const parts = text.trim().split(/\s+/).slice(0, 3).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? (parts as [number, number, number]) : null;
}

/** `systemctl show --property=Id,LoadState,ActiveState,SubState a b c` → one entry per unit. */
export function parseUnits(text: string): { id: string; loaded: boolean; active: string; sub: string }[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => Object.fromEntries(block.split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])))
    .filter((unit) => unit.Id)
    .map((unit) => ({ id: String(unit.Id).replace(/\.service$/, ""), loaded: unit.LoadState === "loaded", active: unit.ActiveState ?? "", sub: unit.SubState ?? "" }));
}

/** `systemctl --failed --plain --no-legend` → the failed unit names. */
export const parseFailed = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((name) => name && name !== "0")
    .map((name) => name.replace(/\.service$/, ""));

/** `sshd -T` → the settings that matter. */
export function parseSshd(text: string): { password: boolean; rootLogin: string; port: number } | null {
  const value = (name: string) => new RegExp(`^${name}\\s+(\\S+)`, "mi").exec(text)?.[1]?.toLowerCase();
  const password = value("passwordauthentication");
  if (!password) return null;
  return { password: password === "yes", rootLogin: value("permitrootlogin") ?? "unknown", port: Number(value("port") ?? 22) || 22 };
}

/** `ss -Hltn` → the TCP ports listening outside localhost. */
export function parsePublicPorts(text: string): number[] {
  const ports = new Set<number>();
  for (const line of text.split("\n")) {
    const local = line.trim().split(/\s+/)[3];
    if (!local) continue;
    const at = local.lastIndexOf(":");
    const host = local.slice(0, at).replace(/^\[|\]$/g, "").replace(/%.*$/, "");
    const port = Number(local.slice(at + 1));
    if (!Number.isFinite(port) || /^(127\.|::1$|localhost)/.test(host) || host.startsWith("::ffff:127.")) continue;
    ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}

/** `apt-check` writes "<updates>;<security updates>" on stderr. */
export function parseAptCheck(text: string): { updates: number; security: number } | null {
  const match = /(\d+);(\d+)/.exec(text);
  return match ? { updates: Number(match[1]), security: Number(match[2]) } : null;
}

/** `hermes update --check` → is there a newer Hermes? */
export function parseUpdateCheck(text: string): { available: boolean; version: string | null } | null {
  if (/already up to date/i.test(text)) return { available: false, version: null };
  if (/available|behind/i.test(text)) return { available: true, version: /v?(\d+\.\d+\.\d+)/.exec(text.split(/available/i)[1] ?? text)?.[1] ?? null };
  return null;
}

// ---------- Hermes ----------

function gateway(status: HermesStatus | null): Check[] {
  const gw = { id: "hermes.gateway", category: "hermes", title: "Agent" } as const;
  const chat = { id: "hermes.chat", category: "hermes", title: "Chat" } as const;
  if (!status) {
    const detail = ["The Hermes dashboard API does not answer on this server.", "On the server: systemctl status hermes-dashboard"];
    return [{ ...gw, tone: "bad", summary: "Hermes is not answering", detail }, idle(chat, "Unknown while Hermes is down")];
  }
  const version = `Hermes ${status.version}`;
  if (!status.gatewayRunning) {
    // The Hermes board runs its tasks inside the gateway: a task cannot restart it, so the page says what to run.
    const detail = ["The gateway runs the agent, its chat and its tasks.", "On the server: hermes gateway restart"];
    return [{ ...gw, tone: "bad", summary: `${version}, gateway stopped`, detail }, idle(chat, "Disconnected while the gateway is stopped")];
  }
  const platforms = status.platforms.map((p) => p[0]!.toUpperCase() + p.slice(1));
  return [
    { ...gw, tone: status.overall === "ok" ? "good" : "warn", summary: status.overall === "ok" ? `${version}, running` : `${version}, running (${status.overall})` },
    platforms.length
      ? { ...chat, tone: "good", summary: `Connected to ${platforms.join(", ")}` }
      : {
          ...chat,
          tone: "warn",
          summary: "No chat connected",
          fix: checkFix("hermes.chat", "connect a chat to Hermes", "The Hermes gateway runs but no chat platform (Telegram, Discord...) is connected.", [], [
            "Read the gateway logs (hermes logs gateway) to see why the platform does not connect.",
            "If a bot token is missing or wrong, ask the owner for it on any channel that works; never guess one.",
          ]),
        },
  ];
}

async function crons(ctx: CheckContext): Promise<Check> {
  const base = { id: "hermes.crons", category: "hermes", title: "Crons" } as const;
  const jobs = await ctx.hermes.api<Json[]>("/api/cron/jobs").catch(() => null);
  if (!Array.isArray(jobs)) return idle(base, "Could not read the crons");
  const active = jobs.filter((job) => job.enabled !== false && job.state !== "completed");
  const streak = (job: Json) => (typeof job.failure_streak === "number" ? job.failure_streak : 0);
  const name = (job: Json) => String(job.name || job.id);
  // One failed run is often the network or the model provider: it counts only once it repeats.
  const failing = active.filter((job) => streak(job) >= 3);
  const flaky = active.filter((job) => streak(job) < 3 && (job.last_status === "error" || job.last_delivery_error));
  if (failing.length) {
    const detail = failing.map((job) => `${name(job)}: failed ${streak(job)} times in a row${job.last_error ? ` (${String(job.last_error).slice(0, 160)})` : ""}`);
    return {
      ...base,
      tone: "bad",
      summary: `${failing.length} cron${failing.length > 1 ? "s" : ""} keep failing`,
      detail,
      fix: checkFix(`hermes.crons:${failing.map(name).join(",")}`, `cron ${failing.map(name).join(", ")} keeps failing`, "Some Hermes crons fail every time they run.", detail, [
        "Read the last runs of each cron (hermes cron list, then its output in ~/.hermes/cron/output/<id>/).",
        "Fix the cause (a script, a skill, a missing setting). Do not delete a cron or change its schedule without asking.",
      ]),
    };
  }
  if (flaky.length) {
    return { ...base, tone: "warn", summary: `${flaky.length} cron${flaky.length > 1 ? "s" : ""} failed last time`, detail: flaky.map((job) => `${name(job)}: ${String(job.last_error || job.last_delivery_error || "error").slice(0, 160)}`) };
  }
  return { ...base, tone: "good", summary: active.length ? `${active.length} cron${active.length > 1 ? "s" : ""}, all fine` : "No cron yet" };
}

async function hermesUpdate(ctx: CheckContext): Promise<Check> {
  const base = { id: "hermes.update", category: "hermes", title: "Hermes version" } as const;
  const answer = await ctx.cached("hermes-update", 6 * HOUR, async () => {
    const result = await ctx.system.run(ctx.hermesBin, ["update", "--check"], { timeoutMs: 60_000 });
    return parseUpdateCheck(`${result.stdout}\n${result.stderr}`);
  });
  if (!answer) return idle(base, "Could not check for updates");
  if (!answer.available) return { ...base, tone: "good", summary: "Up to date" };
  const version = answer.version ? `Hermes ${answer.version}` : "A new Hermes";
  return {
    ...base,
    tone: "warn",
    summary: `${version} is available`,
    fix: checkFix("hermes.update", `update Hermes${answer.version ? ` to ${answer.version}` : ""}`, `${version} is available on this server.`, [], [
      "Read what changed: hermes update --plan.",
      "Tell the owner on chat that Hermes restarts for a minute, then run: hermes update --yes",
      "Check that it came back: hermes --version, and that the chat answers.",
    ]),
  };
}

// ---------- Services ----------

async function services(ctx: CheckContext): Promise<Check> {
  const base = { id: "services.units", category: "services", title: "Services" } as const;
  const shown = await ctx.system.run("systemctl", ["show", "--property=Id,LoadState,ActiveState,SubState", ...KEY_UNITS.map((u) => `${u}.service`)]);
  if (shown.code === 127) return idle(base, "Not a Linux server with systemd");
  const units = parseUnits(shown.stdout).filter((unit) => unit.loaded);
  const failedRun = await ctx.system.run("systemctl", ["--failed", "--plain", "--no-legend", "--no-pager"]);
  const others = parseFailed(failedRun.stdout).filter((name) => !KEY_UNITS.includes(name));

  const restarted: string[] = [];
  const down: string[] = [];
  for (const unit of units.filter((u) => u.active !== "active" && u.active !== "reloading" && u.active !== "activating")) {
    if (SAFE_RESTART.has(unit.id) && (await ctx.restart(unit.id))) restarted.push(unit.id);
    else down.push(unit.id);
  }

  const detail = [
    ...down.map((name) => `${name} is stopped`),
    ...restarted.map((name) => `${name} was stopped: restarted on its own`),
    ...others.map((name) => `${name} failed`),
  ];
  const autoFixed = restarted.length ? `Restarted ${restarted.join(", ")}` : undefined;
  if (down.length) {
    return {
      ...base,
      tone: "bad",
      summary: `${down.join(", ")} ${down.length > 1 ? "are" : "is"} stopped`,
      detail,
      autoFixed,
      fix: checkFix(`services.units:${down.join(",")}`, `restart ${down.join(", ")}`, `These services are stopped: ${down.join(", ")}.`, detail, [
        "Read why with systemctl status <name> and journalctl -u <name> -n 100.",
        "Fix the cause, then systemctl restart <name> and check it stays active.",
      ]),
    };
  }
  if (others.length) {
    return {
      ...base,
      tone: "warn",
      summary: `${others.length} other service${others.length > 1 ? "s" : ""} failed`,
      detail,
      autoFixed,
      fix: checkFix(`services.failed:${others.join(",")}`, `failed service ${others.join(", ")}`, `These services failed: ${others.join(", ")}.`, detail, [
        "Read why with systemctl status <name> and journalctl -u <name> -n 100.",
        "If the service is not needed any more, say so and ask the owner before disabling it.",
      ]),
    };
  }
  return { ...base, tone: "good", summary: units.length ? `${units.length} services running` : "No known service on this server", detail: autoFixed ? detail : undefined, autoFixed };
}

// ---------- Server ----------

async function disk(ctx: CheckContext): Promise<Check> {
  const base = { id: "server.disk", category: "server", title: "Disk" } as const;
  const space = await ctx.system.disk("/");
  if (!space || !space.total) return idle(base, "Could not read the disk");
  const used = ((space.total - space.free) / space.total) * 100;
  const summary = `${percent(used)} used, ${Math.round(space.free / GB)} GB free`;
  if (used < 85) return { ...base, tone: "good", summary };
  return {
    ...base,
    tone: used >= 92 ? "bad" : "warn",
    summary,
    fix: checkFix("server.disk", "free disk space", `The server disk is ${percent(used)} full.`, [summary], [
      "Find what takes the space: du -xh / --max-depth=2 | sort -h | tail -20, and journalctl --disk-usage.",
      "Clean only what is safe to remove (old logs with journalctl --vacuum-time=14d, apt-get clean, old build caches). List anything else and ask the owner.",
    ]),
  };
}

async function memory(ctx: CheckContext): Promise<Check> {
  const base = { id: "server.memory", category: "server", title: "Memory" } as const;
  const info = parseMeminfo((await ctx.system.read("/proc/meminfo")) ?? "");
  if (!info) return idle(base, "Could not read the memory");
  const free = (info.available / info.total) * 100;
  const summary = `${percent(100 - free)} used, ${(info.available / 1024 / 1024).toFixed(1)} GB available`;
  if (free >= 15) return { ...base, tone: "good", summary };
  return {
    ...base,
    tone: free < 5 ? "bad" : "warn",
    summary,
    fix: checkFix("server.memory", "memory almost full", `Only ${percent(free)} of the memory is available.`, [summary], [
      "Find the biggest programs: ps aux --sort=-rss | head -15.",
      "Say which one grows and why. Restart a program only if it is safe; ask the owner for anything else (adding swap, a bigger server).",
    ]),
  };
}

async function load(ctx: CheckContext): Promise<Check> {
  const base = { id: "server.load", category: "server", title: "Load" } as const;
  const avg = parseLoadavg((await ctx.system.read("/proc/loadavg")) ?? "");
  if (!avg) return idle(base, "Could not read the load");
  const cpus = ctx.system.cpus();
  const summary = `${avg[1].toFixed(2)} over 5 min, ${cpus} CPU${cpus > 1 ? "s" : ""}`;
  const tone: Tone = avg[1] > cpus * 2 ? "bad" : avg[2] > cpus ? "warn" : "good";
  if (tone === "good") return { ...base, tone, summary };
  return {
    ...base,
    tone,
    summary,
    fix: checkFix("server.load", "server overloaded", `The server is busier than its ${cpus} CPU${cpus > 1 ? "s" : ""} can handle.`, [summary], [
      "Find what uses the CPU: ps aux --sort=-%cpu | head -15.",
      "Say what it is and whether it is expected. Stop only a stuck program you started yourself; ask the owner for anything else.",
    ]),
  };
}

async function reboot(ctx: CheckContext): Promise<Check> {
  const base = { id: "server.reboot", category: "server", title: "Restart" } as const;
  if (!(await ctx.system.exists("/proc/uptime"))) return idle(base, "Not a Linux server");
  const uptime = Number(((await ctx.system.read("/proc/uptime")) ?? "").split(" ")[0]);
  const days = Number.isFinite(uptime) ? Math.floor(uptime / 86_400) : null;
  const since = days === null ? "" : `, up for ${days} day${days === 1 ? "" : "s"}`;
  if (!(await ctx.system.exists("/var/run/reboot-required"))) return { ...base, tone: "good", summary: `No restart needed${since}` };
  const packages = ((await ctx.system.read("/var/run/reboot-required.pkgs")) ?? "").split("\n").filter(Boolean);
  const detail = packages.length ? [`For updates of ${[...new Set(packages)].slice(0, 6).join(", ")}`] : undefined;
  return {
    ...base,
    tone: "warn",
    summary: `A restart is pending${since}`,
    detail,
    fix: checkFix("server.reboot", "plan a server restart", "The server installed updates that only apply after a restart.", detail, [
      "Check that every service starts on its own at boot (systemctl is-enabled caddy vps-gate vps-tunnel hermes-dashboard dashboard).",
      "Ask the owner on chat when to restart, then plan it at that time with shutdown -r HH:MM (never restart right away).",
    ]),
  };
}

async function securityUpdates(ctx: CheckContext): Promise<Check> {
  const base = { id: "server.updates", category: "server", title: "System updates" } as const;
  const counts = await ctx.cached("apt-check", 6 * HOUR, async () => {
    const result = await ctx.system.run("/usr/lib/update-notifier/apt-check", [], { timeoutMs: 60_000 });
    return result.code === 0 ? parseAptCheck(result.stderr || result.stdout) : null;
  });
  if (!counts) return idle(base, "Could not count the updates");
  if (!counts.security) return { ...base, tone: "good", summary: counts.updates ? `No security update, ${counts.updates} other${counts.updates > 1 ? "s" : ""}` : "Up to date" };
  return {
    ...base,
    tone: "warn",
    summary: `${counts.security} security update${counts.security > 1 ? "s" : ""} waiting`,
    fix: checkFix("server.updates", "install security updates", `${counts.security} security updates are waiting on the server.`, [], [
      "Install them: apt-get update, then apt-get -y upgrade (never dist-upgrade or a release upgrade).",
      "Check that unattended-upgrades is on so the next ones install on their own.",
      "Say if a restart is needed afterwards; do not restart.",
    ]),
  };
}

async function oom(ctx: CheckContext): Promise<Check> {
  const base = { id: "server.oom", category: "server", title: "Out of memory" } as const;
  const result = await ctx.system.run("journalctl", ["-k", "--since", "24 hours ago", "--no-pager", "-q", "-o", "cat"], { timeoutMs: 20_000 });
  if (result.code === 127 || (result.code !== 0 && !result.stdout)) return idle(base, "Could not read the system log");
  const kills = result.stdout.split("\n").filter((line) => /out of memory|oom-kill|killed process/i.test(line));
  const victims = [...new Set(kills.map((line) => /\(([^)]+)\)/.exec(line)?.[1]).filter(Boolean))] as string[];
  if (!kills.length) return { ...base, tone: "good", summary: "No program killed in 24 h" };
  return {
    ...base,
    tone: "warn",
    summary: `Programs killed for lack of memory in 24 h`,
    detail: victims.length ? [`Killed: ${victims.slice(0, 6).join(", ")}`] : undefined,
    fix: checkFix("server.oom", "programs killed for lack of memory", "The system killed programs in the last 24 hours because memory ran out.", victims.length ? [`Killed: ${victims.join(", ")}`] : [], [
      "Read the kills: journalctl -k --since \"24 hours ago\" | grep -i -A3 \"out of memory\".",
      "Find what grew and why. Ask the owner before adding swap or changing limits.",
    ]),
  };
}

// ---------- Security ----------

async function ssh(ctx: CheckContext): Promise<{ check: Check; port: number }> {
  const base = { id: "security.ssh", category: "security", title: "SSH login" } as const;
  const result = await ctx.system.run("sshd", ["-T"]);
  const settings = parseSshd(result.stdout);
  if (!settings) return { check: idle(base, "Could not read the SSH settings"), port: 22 };
  const issues = [
    settings.password ? "Anyone can try passwords (PasswordAuthentication yes)" : null,
    settings.rootLogin === "yes" ? "root can log in with a password (PermitRootLogin yes)" : null,
  ].filter(Boolean) as string[];
  if (!issues.length) return { check: { ...base, tone: "good", summary: "Keys only" }, port: settings.port };
  return {
    port: settings.port,
    check: {
      ...base,
      tone: "warn",
      summary: settings.password ? "Password login is on" : "root can log in with a password",
      detail: issues,
      fix: checkFix("security.ssh", "SSH login with keys only", "SSH accepts passwords, so anyone on the internet can try to guess one.", issues, [
        "Check that the owner's SSH key is in ~/.ssh/authorized_keys of the user they log in with. If there is none, stop: ask the owner to add their key first.",
        "Add a file /etc/ssh/sshd_config.d/10-keys-only.conf with PasswordAuthentication no and PermitRootLogin prohibit-password.",
        "Check the config with sshd -t, then systemctl reload ssh. Keep your current session open and ask the owner to confirm a new SSH login works.",
      ]),
    },
  };
}

async function firewall(ctx: CheckContext, sshPort: number): Promise<{ check: Check; active: boolean | null }> {
  const base = { id: "security.firewall", category: "security", title: "Firewall" } as const;
  const result = await ctx.system.run("ufw", ["status"]);
  if (result.code === 127 || !/status:/i.test(result.stdout)) return { check: idle(base, "ufw is not installed"), active: null };
  if (/status:\s*active/i.test(result.stdout)) return { check: { ...base, tone: "good", summary: "On" }, active: true };
  return {
    active: false,
    check: {
      ...base,
      tone: "warn",
      summary: "Off",
      detail: ["Every program listening on a public port can be reached from the internet."],
      fix: checkFix("security.firewall", "turn the firewall on", "The firewall (ufw) is off.", [], [
        `Confirm the SSH port (sshd -T | grep ^port, here ${sshPort}). The dashboard and Hermes go through the Cloudflare tunnel: SSH is the only port to allow.`,
        `Allow SSH first: ufw allow ${sshPort}/tcp. Open no other port.`,
        "Ask the owner on chat before the next step, since a mistake can lock everyone out.",
        "Then ufw --force enable, keep your session open, and ask the owner to confirm a new SSH login works.",
      ]),
    },
  };
}

async function exposure(ctx: CheckContext, sshPort: number, firewallOn: boolean | null): Promise<Check> {
  const base = { id: "security.exposure", category: "security", title: "Open to the internet" } as const;
  const result = await ctx.system.run("ss", ["-Hltn"]);
  if (result.code !== 0) return idle(base, "Could not list the open ports");
  const extra = parsePublicPorts(result.stdout).filter((port) => port !== sshPort);
  if (!extra.length) return { ...base, tone: "good", summary: `Only SSH (port ${sshPort})` };
  const ports = extra.join(", ");
  if (firewallOn) return { ...base, tone: "good", summary: `Ports ${ports} listen, the firewall filters them` };
  return {
    ...base,
    tone: "warn",
    summary: `Ports ${ports} are reachable`,
    detail: ["The dashboard and Hermes should only be reached through the tunnel and the sign-in gate."],
    fix: checkFix(`security.exposure:${ports}`, `close public ports ${ports}`, `These ports listen on every network address while the firewall is off: ${ports}.`, [], [
      "Find the program behind each port: ss -ltnp.",
      "When it should only be local, make it listen on 127.0.0.1 in its own settings. Ask the owner before changing anything they use.",
    ]),
  };
}

/** Every check, in the order of the page. */
export async function runChecks(ctx: CheckContext): Promise<Check[]> {
  const status = await ctx.hermes.status().catch(() => null);
  const [hermes, cronCheck, update, units, diskCheck, mem, cpu, restart, updates, kills, sshCheck] = await Promise.all([
    gateway(status),
    crons(ctx),
    hermesUpdate(ctx),
    services(ctx),
    disk(ctx),
    memory(ctx),
    load(ctx),
    reboot(ctx),
    securityUpdates(ctx),
    oom(ctx),
    ssh(ctx),
  ]);
  const wall = await firewall(ctx, sshCheck.port);
  const open = await exposure(ctx, sshCheck.port, wall.active);
  return [...hermes, cronCheck, update, units, diskCheck, mem, cpu, restart, updates, kills, sshCheck.check, wall.check, open];
}
