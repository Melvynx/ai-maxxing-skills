import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { claudeAccountsFile, readClaudeAccounts, toClaudeAccounts } from "./claude-accounts";

const FILE = {
  checked_at: "2026-11-13T01:57:08Z",
  note: "order ok",
  accounts: [
    { id: "a1", label: "work", email: "work@example.com", manual: true, used: 14, elapsed: 8.9, delta: -5.1, five: 0, full: false, resets_at: "2026-11-19T11:00:00.931085+00:00" },
    { id: "b2", label: "personal", email: null, manual: true, used: 99.5, elapsed: 67.2, delta: -32.3, five: 0, full: true, resets_at: "soon" },
  ],
};

describe("claude accounts", () => {
  it("keeps the order Hermes tries them in and what the page shows", () => {
    expect(toClaudeAccounts(FILE)).toEqual({
      checkedAt: Date.parse("2026-11-13T01:57:08Z"),
      accounts: [
        { id: "a1", label: "work", email: "work@example.com", used: 14, elapsed: 8.9, delta: -5.1, full: false, resetsAt: Date.parse("2026-11-19T11:00:00.931Z") },
        { id: "b2", label: "personal", email: null, used: 99.5, elapsed: 67.2, delta: -32.3, full: true, resetsAt: null },
      ],
    });
  });

  it("shows nothing for a file it cannot trust", () => {
    expect(toClaudeAccounts(null)).toBeNull();
    expect(toClaudeAccounts({ ...FILE, accounts: [] })).toBeNull();
    expect(toClaudeAccounts({ ...FILE, checked_at: "yesterday" })).toBeNull();
    expect(toClaudeAccounts({ ...FILE, accounts: [{ id: "a1", label: "x", used: "14" }] })).toBeNull();
  });

  it("reads the file of the Hermes folder, and answers null when it is missing or broken", async () => {
    const home = await mkdtemp(join(tmpdir(), "claude-accounts-"));
    expect(claudeAccountsFile(home)).toBe(join(home, "cache", "claude-pool-priority.json"));
    await writeFile(join(home, "ok.json"), JSON.stringify(FILE));
    await writeFile(join(home, "broken.json"), "{");
    expect((await readClaudeAccounts(join(home, "ok.json")))?.accounts.map((a) => a.label)).toEqual(["work", "personal"]);
    expect(await readClaudeAccounts(join(home, "broken.json"))).toBeNull();
    expect(await readClaudeAccounts(claudeAccountsFile(home))).toBeNull();
  });
});
