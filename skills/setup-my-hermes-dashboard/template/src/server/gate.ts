import { execFile } from "node:child_process";
import { z } from "zod";

/**
 * Who can sign in to the dashboard, read from and changed through the server's gate (`expose user ...`), for the
 * Team page. Always `execFile` with an args array and a checked, lowercased email, never a shell string.
 * `GATE_COMMANDS` picks the mode: `on` runs the commands, `dry-run` (the default outside production) only says what
 * it would run (the read-only `user list` still runs), `off` does nothing.
 * `expose` runs as root only: when the dashboard service runs as another user, the list is "unavailable" and the
 * page tells the owner to ask Hermes instead.
 */

export type GateMode = "on" | "dry-run" | "off";
export type Access = { email: string; role: "admin" | "member" };
export type AccessList = { available: true; users: Access[] } | { available: false };
/** What a change did: the command it ran (or would run), and whether it really ran. */
export type GateResult = { command: string[]; ran: boolean };

export type Exec = (file: string, args: string[], timeoutMs: number) => Promise<string>;

const exec: Exec = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1_000_000, encoding: "utf8" }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      // expose explains a refusal in one short line on stderr ("x is the last admin..."): keep that line only.
      const reason = String(stderr).split("\n")[0]?.trim().slice(0, 200);
      reject(new Error(error.killed ? "expose did not answer in time" : reason || `expose failed (exit ${error.code ?? "?"})`));
    });
  });

/** A plain email: no space, no shell character, no option. `a@b.c --invite`, `;` and newlines are refused. */
export const gateEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(160)
  .regex(/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/, "Not a valid email address");

export function gateMode(env: NodeJS.ProcessEnv = process.env): GateMode {
  const value = env.GATE_COMMANDS?.trim();
  if (value === "on" || value === "dry-run" || value === "off") return value;
  return env.NODE_ENV === "production" ? "on" : "dry-run";
}

/** `expose user list` prints one `email role` per line; any other line is ignored. */
export function parseUsers(stdout: string): Access[] {
  return stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([email, role]) => email && gateEmail.safeParse(email).success && (role === "admin" || role === "member"))
    .map(([email, role]) => ({ email: email!.toLowerCase(), role: role as Access["role"] }));
}

export class Gate {
  constructor(
    readonly mode: GateMode = gateMode(),
    private readonly bin: string = process.env.EXPOSE_BIN?.trim() || "/usr/local/bin/expose",
    private readonly run: Exec = exec,
  ) {}

  async listAccess(): Promise<AccessList> {
    if (this.mode === "off") return { available: false };
    try {
      return { available: true, users: parseUsers(await this.run(this.bin, ["user", "list"], 15_000)) };
    } catch (error) {
      console.error("gate: user list failed:", (error as Error).message.slice(0, 120));
      return { available: false };
    }
  }

  /** Lets this email sign in as a member. `invite` emails them the link (a real email to a real person). */
  async grantAccess(email: string, { invite }: { invite: boolean }): Promise<GateResult> {
    const address = gateEmail.parse(email);
    const list = await this.listAccess();
    if (list.available && list.users.some((u) => u.email === address && u.role === "admin")) throw new Error("This address is an admin: its access does not change from here");
    return this.change(["user", "add", address, "member", ...(invite ? ["--invite"] : [])]);
  }

  /** Takes the access away and signs them out at once. Never an admin, never the viewer themself. */
  async revokeAccess(email: string, viewerEmail: string | null): Promise<GateResult> {
    const address = gateEmail.parse(email);
    if (viewerEmail && address === viewerEmail.toLowerCase()) throw new Error("You cannot remove your own access");
    const list = await this.listAccess();
    if (!list.available) throw new Error("The access list is unavailable right now");
    if (list.users.some((u) => u.email === address && u.role === "admin")) throw new Error("An admin's access cannot be removed from here");
    return this.change(["user", "remove", address]);
  }

  private async change(args: string[]): Promise<GateResult> {
    if (this.mode === "off") throw new Error("Access changes are turned off on this server (GATE_COMMANDS=off)");
    if (this.mode === "dry-run") return { command: ["expose", ...args], ran: false };
    await this.run(this.bin, args, 30_000);
    return { command: ["expose", ...args], ran: true };
  }
}
