import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Idempotent bootstrap: tables are only ever added, never dropped or rewritten. Keep it in sync with schema.ts. */
const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER, last_used_at INTEGER, revoked_at INTEGER
);
`;

/** Opens (and creates) `<dataDir>/dashboard.sqlite3`: owner-only folder and file, WAL, synchronous FULL. */
export function openDb(dataDir: string): Db {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
  const file = path.join(dataDir, "dashboard.sqlite3");
  const sqlite = new Database(file);
  fs.chmodSync(file, 0o600);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = FULL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(BOOTSTRAP);
  return drizzle(sqlite, { schema }) as Db;
}

/** `BEGIN IMMEDIATE` transaction: better-sqlite3 is synchronous, so nothing else runs until it returns. */
export function tx<T>(db: Db, run: (db: Db) => T): T {
  return db.$client.transaction(() => run(db)).immediate();
}

/** HMAC pepper of API key digests: DASHBOARD_KEY_PEPPER, else a 0600 file created once next to the database. */
export function readPepper(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.DASHBOARD_KEY_PEPPER) return env.DASHBOARD_KEY_PEPPER;
  const file = path.join(dataDir, "key-pepper");
  try {
    fs.writeFileSync(file, randomBytes(48).toString("base64url"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return fs.readFileSync(file, "utf8").trim();
}
