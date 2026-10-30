import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(),
  digest: text("digest").notNull(),
  /** Space-separated, sorted. */
  scopes: text("scopes").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at"),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
});


/** One Infra health run (every 15 minutes, and on "Check now"): its checks as JSON. Kept 7 days. */
export const infraRuns = sqliteTable("infra_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Milliseconds. */
  at: integer("at").notNull(),
  tone: text("tone").notNull(),
  checks: text("checks").notNull(),
});

/** A task an admin sent to the Hermes board from the Infra pages. */
export const infraFixes = sqliteTable("infra_fixes", {
  id: text("id").primaryKey(),
  /** "health" or "audit". */
  source: text("source").notNull(),
  /** Same problem, same key: one open task per key. */
  key: text("key").notNull(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  /** The Hermes board task, once created. */
  taskId: text("task_id"),
  /** queued | running | blocked | done | failed. */
  status: text("status").notNull(),
  note: text("note"),
  /** Email of the admin who sent it. */
  actor: text("actor"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Small Infra flags, e.g. that the daily audit cron was created once. */
export const infraState = sqliteTable("infra_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
