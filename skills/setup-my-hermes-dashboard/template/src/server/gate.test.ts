import { describe, expect, it, vi } from "vitest";

import { Gate, gateEmail, gateMode, parseUsers, type Exec } from "./gate";

/** A gate whose `expose` is a fake that records every call. */
function fakeGate(mode: "on" | "dry-run" | "off", users = "owner@example.com admin\nbob@example.com member\n") {
  const calls: { file: string; args: string[] }[] = [];
  const run: Exec = async (file, args) => {
    calls.push({ file, args });
    return args[1] === "list" ? users : "user ok\n";
  };
  return { gate: new Gate(mode, "/usr/local/bin/expose", run), calls };
}

describe("gate", () => {
  it("checks emails strictly", () => {
    expect(gateEmail.parse(" Bob@Example.com ")).toBe("bob@example.com");
    for (const bad of ["a@b.c --invite", "a@b.com;rm", "a@b.com\nx@y.com admin", "--invite", "a b@c.com", "$(id)@x.com"]) expect(gateEmail.safeParse(bad).success).toBe(false);
  });

  it("runs commands in production only, unless GATE_COMMANDS says otherwise", () => {
    expect(gateMode({})).toBe("dry-run");
    expect(gateMode({ NODE_ENV: "production" })).toBe("on");
    expect(gateMode({ NODE_ENV: "production", GATE_COMMANDS: "off" })).toBe("off");
    expect(gateMode({ GATE_COMMANDS: "weird" })).toBe("dry-run");
  });

  it("reads expose's user list", () => {
    expect(parseUsers("owner@example.com admin\n\nbob@example.com member\njunk\nx@y.com owner\n")).toEqual([
      { email: "owner@example.com", role: "admin" },
      { email: "bob@example.com", role: "member" },
    ]);
  });

  it("says the list is unavailable when expose fails", async () => {
    const gate = new Gate("on", "/usr/local/bin/expose", async () => {
      throw new Error("run as root");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await gate.listAccess()).toEqual({ available: false });
    error.mockRestore();
  });

  it("runs changes with an args array in `on` mode", async () => {
    const { gate, calls } = fakeGate("on");
    await gate.grantAccess("New@Example.com", { invite: true });
    expect(calls.at(-1)).toEqual({ file: "/usr/local/bin/expose", args: ["user", "add", "new@example.com", "member", "--invite"] });
    await gate.revokeAccess("bob@example.com", "owner@example.com");
    expect(calls.at(-1)!.args).toEqual(["user", "remove", "bob@example.com"]);
  });

  it("only says what it would run in dry-run, and does nothing when off", async () => {
    const { gate, calls } = fakeGate("dry-run");
    expect(await gate.grantAccess("new@example.com", { invite: false })).toEqual({ command: ["expose", "user", "add", "new@example.com", "member"], ran: false });
    expect(calls.every((c) => c.args[1] === "list")).toBe(true);
    const off = fakeGate("off");
    expect(await off.gate.listAccess()).toEqual({ available: false });
    await expect(off.gate.grantAccess("new@example.com", { invite: false })).rejects.toThrow(/turned off/);
    expect(off.calls).toEqual([]);
  });

  it("never removes an admin or oneself, and never turns an admin into a member", async () => {
    const { gate } = fakeGate("on");
    await expect(gate.revokeAccess("owner@example.com", "other@example.com")).rejects.toThrow(/admin/);
    await expect(gate.revokeAccess("bob@example.com", "Bob@example.com")).rejects.toThrow(/your own access/);
    await expect(gate.grantAccess("owner@example.com", { invite: false })).rejects.toThrow(/admin/);
    await expect(gate.grantAccess("a@b.c --invite", { invite: false })).rejects.toThrow();
  });
});
