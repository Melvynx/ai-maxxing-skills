#!/usr/bin/env node
// Creates the API key Hermes uses, without ever printing it: the key goes straight into a 0600 env file.
//   node scripts/new-key.mjs <env-file> [name] [base-url]
// It writes DASHBOARD_API_BASE and DASHBOARD_API_TOKEN, revokes the previous key of that name, and prints the key id.
// Same format as src/server/db/api-keys.ts (sk_dash_<prefix>_<secret>, HMAC-SHA256 digest keyed by the pepper);
// db.test.ts checks that the dashboard accepts what this script creates.
import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const [envFile, name = "hermes", base = "http://127.0.0.1:8794"] = process.argv.slice(2);
if (!envFile) {
  console.error("usage: node scripts/new-key.mjs <env-file> [name] [base-url]");
  process.exit(2);
}

const dataDir = path.resolve(process.env.DATA_DIR?.trim() || ".data");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

// Same pepper as the server: the env variable, else the 0600 file next to the database (created once).
let pepper = process.env.DASHBOARD_KEY_PEPPER;
if (!pepper) {
  const file = path.join(dataDir, "key-pepper");
  try {
    fs.writeFileSync(file, randomBytes(48).toString("base64url"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  pepper = fs.readFileSync(file, "utf8").trim();
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const prefix = [...randomBytes(10)].map((byte) => BASE32[byte & 31]).join("");
const token = `sk_dash_${prefix}_${randomBytes(32).toString("base64url")}`;
const id = `key_${randomBytes(8).toString("hex")}`;
const now = Math.floor(Date.now() / 1000);

const dbFile = path.join(dataDir, "dashboard.sqlite3");
const db = new Database(dbFile);
fs.chmodSync(dbFile, 0o600);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec(`CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER, last_used_at INTEGER, revoked_at INTEGER
)`);
db.transaction(() => {
  db.prepare("UPDATE api_keys SET revoked_at = ? WHERE name = ? AND revoked_at IS NULL").run(now, name);
  db.prepare("INSERT INTO api_keys (id, name, prefix, digest, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    name,
    prefix,
    createHmac("sha256", pepper).update(token).digest("hex"),
    "dashboard:read dashboard:write",
    now,
  );
})();
db.close();

// Keep the other lines of the env file, replace only the two the dashboard owns.
const kept = fs.existsSync(envFile)
  ? fs
      .readFileSync(envFile, "utf8")
      .split("\n")
      .filter((line) => line && !/^(DASHBOARD_API_BASE|DASHBOARD_API_TOKEN)=/.test(line))
  : [];
fs.mkdirSync(path.dirname(envFile), { recursive: true, mode: 0o700 });
fs.writeFileSync(envFile, [...kept, `DASHBOARD_API_BASE=${base}`, `DASHBOARD_API_TOKEN=${token}`, ""].join("\n"), { mode: 0o600 });
fs.chmodSync(envFile, 0o600);
console.log(`key ${id} (${name}) saved in ${envFile}`);
