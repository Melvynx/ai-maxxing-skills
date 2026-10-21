import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ApiKeys } from "./api-keys";
import { openDb, readPepper } from "./client";

const dirs: string[] = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-"));
  dirs.push(dir);
  return dir;
}
const fresh = () => openDb(tempDir());
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("api keys", () => {
  it("authenticates a new key and stops after revoke", () => {
    const keys = new ApiKeys(fresh(), "pepper");
    const { key, token } = keys.create("crons", ["dashboard:write", "dashboard:read"], null);
    expect(token).toMatch(/^sk_dash_[a-z2-7]{10}_[A-Za-z0-9_-]{43}$/);
    expect(key.masked).not.toContain(token.slice(-43));
    expect([...(keys.authenticate(token)?.scopes ?? [])]).toEqual(["dashboard:read", "dashboard:write"]);
    keys.revoke(key.id);
    expect(keys.authenticate(token)).toBeNull();
  });

  it("refuses expired, malformed and foreign keys", () => {
    const db = fresh();
    const keys = new ApiKeys(db, "pepper");
    const { token } = keys.create("old", ["dashboard:read"], Math.floor(Date.now() / 1000) - 1);
    expect(keys.authenticate(token)).toBeNull();
    expect(keys.authenticate("sk_dash_nope")).toBeNull();
    const { token: other } = keys.create("ok", ["dashboard:read"], null);
    expect(new ApiKeys(db, "another pepper").authenticate(other)).toBeNull();
  });

  it("accepts the key scripts/new-key.mjs writes, and revokes the one it replaces", () => {
    const dir = tempDir();
    const envFile = path.join(dir, "config", "env");
    fs.mkdirSync(path.dirname(envFile));
    fs.writeFileSync(envFile, "OTHER=kept\n");
    const run = () => {
      execFileSync("node", ["scripts/new-key.mjs", envFile, "hermes"], { env: { ...process.env, DATA_DIR: dir, DASHBOARD_KEY_PEPPER: "" } });
      return /^DASHBOARD_API_TOKEN=(.+)$/m.exec(fs.readFileSync(envFile, "utf8"))![1]!;
    };
    const first = run();
    const second = run();
    const keys = new ApiKeys(openDb(dir), readPepper(dir, {}));
    expect(keys.authenticate(second)?.name).toBe("hermes");
    expect(keys.authenticate(first)).toBeNull();
    expect(fs.readFileSync(envFile, "utf8")).toMatch(/^OTHER=kept\nDASHBOARD_API_BASE=http:\/\/127\.0\.0\.1:8794\nDASHBOARD_API_TOKEN=/);
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);
  });
});
