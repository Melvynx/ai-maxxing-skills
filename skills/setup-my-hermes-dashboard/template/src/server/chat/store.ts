import { randomBytes } from "node:crypto";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { chatConversations, chatImages, chatRuns } from "@/server/db/schema";
import { typicalSeconds, type Eta } from "@/lib/chat/eta";
import type { ChatSummary, ChatUnread, ModelChoice, Reasoning } from "@/lib/chat/items";
import { REASONING } from "@/lib/chat/items";

/**
 * The Chat's own rows: conversations (one per person, by email), the runs the page started and the thumbnails of the
 * images sent. Hermes keeps the messages; this keeps who owns what, the model of each answer and the live run.
 */

export type Conversation = typeof chatConversations.$inferSelect;
export type Run = typeof chatRuns.$inferSelect;

export type TitleSource = "auto" | "user" | "hermes" | "ai" | "ai2";

export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export const newConversationId = () => `c_${randomBytes(8).toString("hex")}`;

/** "Sum up yesterday's sales, by product…" → its first words, at most 60 characters. */
export function autoTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "New conversation";
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?-]+$/, "")}…`;
}

const reasoningOf = (value: string | null): Reasoning => (REASONING as readonly string[]).includes(value ?? "") ? (value as Reasoning) : "default";

export const choiceOf = (row: Conversation): ModelChoice | null => (row.provider && row.model ? { provider: row.provider, model: row.model, reasoning: reasoningOf(row.reasoning) } : null);

export class ChatStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  list(email: string, limit = 200): ChatSummary[] {
    const rows = this.db.select().from(chatConversations).where(eq(chatConversations.email, email)).orderBy(desc(chatConversations.updatedAt)).limit(limit).all();
    if (!rows.length) return [];
    const live = new Map<string, Run>();
    for (const run of this.db.select().from(chatRuns).where(and(eq(chatRuns.email, email), eq(chatRuns.status, "running"))).orderBy(chatRuns.createdAt).all()) live.set(run.conversationId, run);
    const typical = live.size ? this.typicalSeconds(email) : null;
    const unread = new Set(this.unread(email).map((u) => u.id));
    return rows.map((r) => {
      const run = live.get(r.id);
      const item: ChatSummary = { id: r.id, title: r.title, updatedAt: r.updatedAt, running: Boolean(run), unread: unread.has(r.id), archivedAt: r.archivedAt ?? null };
      if (run) Object.assign(item, { eta: this.etaOf(run, typical), startedAt: run.createdAt });
      return item;
    });
  }

  /** How long this person's answers usually take: median of their last 30 completed runs, 20 s..15 min (null without any). */
  typicalSeconds(email: string): number | null {
    const rows = this.db
      .select({ createdAt: chatRuns.createdAt, endedAt: chatRuns.endedAt })
      .from(chatRuns)
      .where(and(eq(chatRuns.email, email), eq(chatRuns.status, "completed"), isNotNull(chatRuns.endedAt)))
      .orderBy(desc(chatRuns.createdAt))
      .limit(30)
      .all();
    return typicalSeconds(rows.map((r) => r.endedAt! - r.createdAt));
  }

  /** The countdown of a live run: Hermes's last estimate, else the usual duration since it started (flagged `estimated`). */
  etaOf(run: Run, typical: number | null = this.typicalSeconds(run.email)): Eta | null {
    if (run.etaSeconds !== null && run.etaAt !== null) return { seconds: run.etaSeconds, at: run.etaAt };
    return typical === null ? null : { seconds: typical, at: run.createdAt, estimated: true };
  }

  /** Hermes wrote a new estimate in a live run (« ⏱️ Plus que ~2 min »). */
  setEta(id: string, seconds: number) {
    this.db
      .update(chatRuns)
      .set({ etaSeconds: seconds, etaAt: this.now() })
      .where(and(eq(chatRuns.id, id), eq(chatRuns.status, "running")))
      .run();
  }

  /**
   * The conversations whose last run ended (completed, failed…) after their owner last looked at them, latest first. A
   * stop the person pressed is not news: cancelled runs are left out.
   */
  unread(email: string): ChatUnread[] {
    const rows = this.db.select().from(chatConversations).where(eq(chatConversations.email, email)).all();
    if (!rows.length) return [];
    const last = new Map<string, Run>();
    for (const run of this.db.select().from(chatRuns).where(eq(chatRuns.email, email)).orderBy(chatRuns.createdAt).all()) last.set(run.conversationId, run);
    const out: ChatUnread[] = [];
    for (const row of rows) {
      // Put away on purpose: no badge, no dot (a new message brings it back anyway).
      if (row.archivedAt) continue;
      const run = last.get(row.id);
      if (!run || run.status === "running" || run.status === "cancelled" || run.endedAt === null) continue;
      if (run.endedAt > (row.seenAt ?? 0)) out.push({ id: row.id, title: row.title, endedAt: run.endedAt, status: run.status });
    }
    return out.sort((a, b) => b.endedAt - a.endedAt);
  }

  /** Its owner has it on screen: nothing unread any more. */
  markSeen(id: string, email: string) {
    this.db.update(chatConversations).set({ seenAt: this.now() }).where(and(eq(chatConversations.id, id), eq(chatConversations.email, email))).run();
  }

  /** Every run still marked running, whoever started it (the watcher settles them while nobody has the page open). */
  runningRuns(): Run[] {
    return this.db.select().from(chatRuns).where(eq(chatRuns.status, "running")).all();
  }

  /** One person's conversation rows, latest first (the overseer's read-only list). */
  rows(email: string, limit = 200): Conversation[] {
    return this.db.select().from(chatConversations).where(eq(chatConversations.email, email)).orderBy(desc(chatConversations.updatedAt)).limit(limit).all();
  }

  /** Every email with a conversation. */
  emails(): string[] {
    return this.db.selectDistinct({ email: chatConversations.email }).from(chatConversations).all().map((r) => r.email);
  }

  /** The conversation now on this Hermes session, whoever owns it (the overseer's read only). */
  bySessionAny(sessionId: string): Conversation | null {
    return this.db.select().from(chatConversations).where(eq(chatConversations.sessionId, sessionId)).get() ?? null;
  }

  /** Only the owner's: another email gets null, as if it did not exist. */
  get(id: string, email: string): Conversation | null {
    return this.db.select().from(chatConversations).where(and(eq(chatConversations.id, id), eq(chatConversations.email, email))).get() ?? null;
  }

  bySession(sessionId: string, email: string): Conversation | null {
    return this.db.select().from(chatConversations).where(and(eq(chatConversations.sessionId, sessionId), eq(chatConversations.email, email))).get() ?? null;
  }

  /** Emails whose Chat used this Hermes session (now or before a regenerate). */
  sessionOwners(sessionId: string): string[] {
    const a = this.db.select({ email: chatConversations.email }).from(chatConversations).where(eq(chatConversations.sessionId, sessionId)).all();
    const b = this.db.select({ email: chatRuns.email }).from(chatRuns).where(eq(chatRuns.sessionId, sessionId)).all();
    return [...new Set([...a, ...b].map((r) => r.email))];
  }

  create(input: { email: string; sessionId: string; title: string; choice: ModelChoice | null }): Conversation {
    const at = this.now();
    const row: Conversation = {
      id: newConversationId(),
      email: input.email,
      sessionId: input.sessionId,
      title: input.title,
      titleSource: "auto",
      provider: input.choice?.provider ?? null,
      model: input.choice?.model ?? null,
      reasoning: input.choice?.reasoning ?? null,
      carry: null,
      createdAt: at,
      updatedAt: at,
      seenAt: at,
      archivedAt: null,
    };
    this.db.insert(chatConversations).values(row).run();
    return row;
  }

  /**
   * `user` = typed by the person (never replaced), `hermes` = Hermes's session title, `ai` = smart title after the first
   * answer, `ai2` = rewritten once the conversation went on. `from`: only when the title is still of one of these sources
   * (an automatic title never overwrites one the person typed meanwhile).
   */
  rename(id: string, title: string, source: TitleSource, from?: TitleSource[]): boolean {
    const where = from ? and(eq(chatConversations.id, id), inArray(chatConversations.titleSource, from)) : eq(chatConversations.id, id);
    return this.db.update(chatConversations).set({ title, titleSource: source }).where(where).run().changes > 0;
  }

  /** Conversations whose title an AI may write now: with its source and how many answers they got. */
  untitled(): { row: Conversation; answers: number }[] {
    const rows = this.db.select().from(chatConversations).where(inArray(chatConversations.titleSource, ["auto", "hermes", "ai"])).all();
    if (!rows.length) return [];
    const answers = new Map<string, number>();
    for (const run of this.db.select({ c: chatRuns.conversationId }).from(chatRuns).where(eq(chatRuns.status, "completed")).all()) answers.set(run.c, (answers.get(run.c) ?? 0) + 1);
    return rows.map((row) => ({ row, answers: answers.get(row.id) ?? 0 })).filter((r) => r.answers > 0);
  }

  setChoice(id: string, choice: ModelChoice | null) {
    this.db
      .update(chatConversations)
      .set({ provider: choice?.provider ?? null, model: choice?.model ?? null, reasoning: choice?.reasoning ?? null })
      .where(eq(chatConversations.id, id))
      .run();
  }

  /** A regenerate or an edit: the conversation continues in `sessionId`, after the turns of `carry`. */
  moveSession(id: string, sessionId: string, carry: unknown[]) {
    this.db.update(chatConversations).set({ sessionId, carry: JSON.stringify(carry) }).where(eq(chatConversations.id, id)).run();
  }

  /** Into the Archives (or back out of them). Only the owner's. */
  setArchived(id: string, email: string, archived: boolean) {
    this.db
      .update(chatConversations)
      .set({ archivedAt: archived ? this.now() : null })
      .where(and(eq(chatConversations.id, id), eq(chatConversations.email, email)))
      .run();
  }

  touch(id: string) {
    this.db.update(chatConversations).set({ updatedAt: this.now() }).where(eq(chatConversations.id, id)).run();
  }

  /** Every Hermes session the conversation used, for its deletion. */
  sessions(row: Conversation): string[] {
    const ids = this.db.selectDistinct({ id: chatRuns.sessionId }).from(chatRuns).where(eq(chatRuns.conversationId, row.id)).all().map((r) => r.id);
    return [...new Set([row.sessionId, ...ids])];
  }

  remove(id: string) {
    this.db.delete(chatRuns).where(eq(chatRuns.conversationId, id)).run();
    this.db.delete(chatConversations).where(eq(chatConversations.id, id)).run();
  }

  addRun(input: { id: string; conversation: Conversation; input: string; images: string[]; provider: string | null; model: string | null }): Run {
    const row: Run = {
      id: input.id,
      conversationId: input.conversation.id,
      sessionId: input.conversation.sessionId,
      email: input.conversation.email,
      input: input.input,
      images: JSON.stringify(input.images),
      provider: input.provider,
      model: input.model,
      status: "running",
      error: null,
      createdAt: this.now(),
      endedAt: null,
      etaSeconds: null,
      etaAt: null,
    };
    this.db.insert(chatRuns).values(row).run();
    this.touch(input.conversation.id);
    // Writing in an archived conversation brings it back to the list.
    if (input.conversation.archivedAt) this.db.update(chatConversations).set({ archivedAt: null }).where(eq(chatConversations.id, input.conversation.id)).run();
    return row;
  }

  run(id: string, email: string): Run | null {
    return this.db.select().from(chatRuns).where(and(eq(chatRuns.id, id), eq(chatRuns.email, email))).get() ?? null;
  }

  /** Once: a later end (a second tab, a poll) never rewrites how it ended. */
  endRun(id: string, status: Exclude<RunStatus, "running">, error: string | null = null) {
    this.db
      .update(chatRuns)
      .set({ status, error: error?.slice(0, 2_000) ?? null, endedAt: this.now() })
      .where(and(eq(chatRuns.id, id), eq(chatRuns.status, "running")))
      .run();
  }

  runs(conversationId: string): Run[] {
    return this.db.select().from(chatRuns).where(eq(chatRuns.conversationId, conversationId)).orderBy(chatRuns.createdAt).all();
  }

  activeRun(conversationId: string): Run | null {
    return this.db.select().from(chatRuns).where(and(eq(chatRuns.conversationId, conversationId), eq(chatRuns.status, "running"))).orderBy(desc(chatRuns.createdAt)).get() ?? null;
  }

  saveImage(hash: string, email: string, thumb: string) {
    this.db.insert(chatImages).values({ hash, email, thumb, createdAt: this.now() }).onConflictDoNothing().run();
  }

  thumbs(email: string, hashes: string[]): Map<string, string> {
    if (!hashes.length) return new Map();
    const rows = this.db.select().from(chatImages).where(and(eq(chatImages.email, email), inArray(chatImages.hash, [...new Set(hashes)]))).all();
    return new Map(rows.map((r) => [r.hash, r.thumb]));
  }
}
