import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

/* ---------- Chat (src/server/chat): who owns which Hermes conversation, the live runs, the image thumbnails ---------- */

export const chatConversations = sqliteTable("chat_conversations", {
  id: text("id").primaryKey(),
  /** Its owner: each person sees only their own conversations. */
  email: text("email").notNull(),
  sessionId: text("session_id").notNull(),
  title: text("title").notNull(),
  /** auto (first words) | hermes (Hermes's own title) | ai / ai2 (smart title) | user (renamed). */
  titleSource: text("title_source").notNull(),
  provider: text("provider"),
  model: text("model"),
  reasoning: text("reasoning"),
  /** History to send again after an edit or a retry (the next message starts a fresh Hermes session). */
  carry: text("carry"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  /** When its owner last looked at it: a run ended after this is « unread » (dot, sidebar badge, notification). */
  seenAt: integer("seen_at"),
  /** Archived by its owner (null: in the list). A new message clears it. */
  archivedAt: integer("archived_at"),
});

export const chatRuns = sqliteTable("chat_runs", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  sessionId: text("session_id").notNull(),
  email: text("email").notNull(),
  input: text("input").notNull(),
  /** JSON array of image hashes (chat_images). */
  images: text("images").notNull(),
  provider: text("provider"),
  model: text("model"),
  /** running | completed | failed | cancelled | interrupted. */
  status: text("status").notNull(),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  endedAt: integer("ended_at"),
  /** Hermes's last wait estimate (« ⏱️ ~N min left »), in seconds, and when it was written (ms): the Chat's countdown. */
  etaSeconds: integer("eta_seconds"),
  etaAt: integer("eta_at"),
});

/** The thumbnail of an image sent in the chat, so the history shows it again (Hermes keeps no image). */
export const chatImages = sqliteTable(
  "chat_images",
  {
    hash: text("hash").notNull(),
    email: text("email").notNull(),
    thumb: text("thumb").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.hash, t.email] })],
);
