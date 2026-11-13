import { createHash, randomBytes } from "node:crypto";

import { etaTracker } from "@/lib/chat/eta";
import { frameEvent, sseParser, type RunEvent } from "@/lib/chat/events";
import type { ActiveRun, ChatModel, ChatThread, ModelChoice } from "@/lib/chat/items";
import { toMs as toMsOf } from "@/server/hermes";
import type { Viewer } from "@/server/viewer";

import { chatError, ChatError, type HermesApiServer } from "./hermes-api";
import { lastUserIndex, messageRows, slim, splitImages, textOf, toHistory, toItems, type HermesMessage } from "./history";
import { autoTitle, choiceOf, type ChatStore, type Conversation, type Run, type RunStatus } from "./store";
import { claudeTitleRunner, cleanTitle, RETITLE_AT, TITLE_SYSTEM, titlePrompt, type TitleRunner } from "./titler";

/**
 * The Chat page's server side: it starts Hermes runs for the signed-in admin, relays their events, answers their
 * approvals and questions, stops them, and lists, renames and deletes that person's conversations. Each conversation
 * is a Hermes session of the API Server; Hermes keeps the messages, its memory follows the person
 * (`X-Hermes-Session-Key: dashboard:<email>`).
 */

/** Whose rows they are: the signed-in person's email. */
export const ownerOf = (viewer: Viewer) => viewer.email;

export const sessionKey = (viewer: Viewer) => `dashboard:${ownerOf(viewer)}`;

/** The line Hermes reads before each message, so it knows who talks to it and from where. */
export const whoLine = (viewer: Viewer) => `Message sent from the dashboard chat by ${viewer.email} (${viewer.role}).`;

/**
 * What the dashboard chat can show, read by Hermes with every message (the API Server's default hint says "plain text").
 * These blocks are the chat's generative UI: Hermes writes them, the page draws them (src/components/chat/rich.tsx).
 */
export const RICH_HINT = [
  'This chat renders markdown (headings, lists, tables, bold, code) and rich blocks; ignore the API Server\'s "plain text" instruction here:',
  '- Chart: a ```chart block holding JSON {"type":"bar"|"line"|"area"|"donut","title":"…","unit":"€","labels":["Mon","Tue"],"series":[{"name":"Sales","values":[3,5]}]}. Use it whenever numbers compare or change over time.',
  '- Key numbers: a ```stats block holding JSON [{"label":"Revenue","value":"€1,240","delta":"+12%","tone":"good"|"warn"|"bad"}] (2 to 6 tiles).',
  "- Video, audio or image from a server file or a URL: a ```video block with the absolute path or the URL on the first line, then `title: …` if you want (several files = several lines); or ![title](/path/or/url.mp4); a line MEDIA:/path works too.",
  "- YouTube or Vimeo: ![title](https://youtu.be/<id>) becomes a player.",
  "- Interactive HTML on the fly (mini app, calculator, mockup, rich chart): a ```html-live block holding a full HTML page (inline CSS/JS, libraries from cdn.jsdelivr.net, unpkg, cdnjs or cdn.tailwindcss.com; no network calls to other sites, put the data in the page). It runs in an isolated frame.",
  "For any work longer than ~30 s, first write `⏱️ Estimate: ~N min`, then `⏱️ ~N min left` at each step: the chat shows this countdown.",
  'A line "📎 Attached file: <name> → <path>" in a message = a file sent from the chat, already on the server at that path: read it with your tools.',
].join("\n");

/** One image sent: the picture (≤ 1600 px, made in the browser) and its thumbnail for the history (≤ 512 px). */
export type ImageInput = { data: string; thumb: string };

export type StartInput = {
  conversationId: string | null;
  text: string;
  images: ImageInput[];
  /** null: Hermes's main model. */
  choice: ModelChoice | null;
  /** `regenerate`: the last answer again; `edit`: the last message replaced by `text`. */
  mode: "send" | "regenerate" | "edit";
};

export type ReadOnlyThread = { sessionId: string; title: string; source: string; items: ChatThread["items"] };

export type Started = { conversationId: string; runId: string; title: string; model: string | null };

const DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 3_000_000;
const MAX_THUMB_CHARS = 200_000;

/** The sha256 Hermes names an image with (first 32 hex characters of the decoded bytes). */
export function imageHash(dataUrl: string): string {
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new ChatError("rejected", "Image refused: only PNG, JPEG, GIF and WebP are accepted.", 400);
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ChatError("rejected", "Image refused: it is over 3 MB, even resized.", 400);
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

const TERMINAL_EVENTS: Record<string, Exclude<RunStatus, "running">> = { "run.completed": "completed", "run.failed": "failed", "run.cancelled": "cancelled", "run.interrupted": "interrupted" };

type Json = Record<string, unknown>;

/** Prices per million tokens above which Hermes asks before using a model (hermes_cli/model_cost_guard.py). */
const INPUT_LIMIT = 20;
const OUTPUT_LIMIT = 100;

export function expensiveWarning(model: string, price: unknown): string | null {
  const row = (price ?? null) as Json | null;
  const input = Number(row?.input ?? row?.prompt ?? NaN);
  const output = Number(row?.output ?? row?.completion ?? NaN);
  if (!(input > INPUT_LIMIT) && !(output > OUTPUT_LIMIT)) return null;
  const money = (v: number) => (Number.isFinite(v) ? `$${v.toFixed(2)}/M` : "unknown");
  return `${model} is expensive: ${money(input)} input, ${money(output)} output (Hermes warns above $20/M input or $100/M output). Use it anyway?`;
}

export type ModelsList = { current: { provider: string; model: string } | null; models: ChatModel[] };

/** `/api/model/options` → the models of the connected providers, the main one first. */
export function toModels(options: unknown): ModelsList {
  const data = (options ?? {}) as Json;
  const providers = Array.isArray(data.providers) ? (data.providers as Json[]) : [];
  const current = typeof data.model === "string" && data.model ? { provider: typeof data.provider === "string" ? data.provider : "", model: data.model } : null;
  const models: ChatModel[] = [];
  for (const row of providers) {
    if (row?.authenticated !== true || typeof row.slug !== "string") continue;
    const caps = (row.capabilities ?? {}) as Record<string, Json>;
    const pricing = (row.pricing ?? {}) as Record<string, unknown>;
    for (const model of Array.isArray(row.models) ? row.models : []) {
      if (typeof model !== "string" || !model) continue;
      models.push({ provider: row.slug, providerName: typeof row.name === "string" ? row.name : row.slug, model, reasoning: caps[model]?.reasoning === true, expensive: expensiveWarning(model, pricing[model]) });
    }
  }
  if (current) models.sort((a, b) => Number(b.model === current.model && b.provider === current.provider) - Number(a.model === current.model && a.provider === current.provider));
  return { current, models };
}

/** A run status from Hermes that will not change any more. */
const ENDED = new Set(["completed", "failed", "cancelled", "interrupted"]);

export class Chat {
  private modelsCache: { at: number; value: ModelsList } | null = null;
  private watching: Promise<void> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;

  private titling: Promise<void> | null = null;
  /** Conversation id → when its title may be tried again after a failure. */
  private titleRetry = new Map<string, number>();

  constructor(
    readonly api: HermesApiServer,
    readonly store: ChatStore,
    private readonly now: () => number = Date.now,
    private readonly titleRunner: TitleRunner | null = process.env.VITEST ? null : claudeTitleRunner,
  ) {}

  /**
   * Smart titles: one conversation at a time, in the background of the watcher. After its first answer an automatic
   * title (first words / Hermes's) becomes a real one; after RETITLE_AT answers it is written once more with the whole
   * picture. A title the person typed is never replaced.
   */
  titleOnce(): Promise<void> {
    if (this.titling || !this.titleRunner) return this.titling ?? Promise.resolve();
    const due = this.store
      .untitled()
      .filter(({ row, answers }) => row.titleSource !== "ai" || answers >= RETITLE_AT)
      .filter(({ row }) => (this.titleRetry.get(row.id) ?? 0) <= this.now())
      .sort((a, b) => b.row.updatedAt - a.row.updatedAt)[0];
    if (!due) return Promise.resolve();
    this.titling = (async () => {
      await Promise.resolve();
      await this.writeTitle(due.row, due.answers);
    })()
      .catch(() => void this.titleRetry.set(due.row.id, this.now() + 10 * 60_000))
      .finally(() => {
        this.titling = null;
      });
    return this.titling ?? Promise.resolve();
  }

  private async writeTitle(row: Conversation, answers: number) {
    const runs = this.store.runs(row.id).filter((r) => r.status === "completed" || r.status === "running");
    const questions = runs.map((r) => r.input);
    const rows = [...this.carry(row), ...(await this.messages(row.sessionId))];
    const replies = rows.filter((r) => r.role === "assistant").map((r) => textOf(r.content)).filter((t) => t.trim());
    if (!questions.length && !rows.some((r) => r.role === "user")) throw new Error("nothing to title");
    if (!questions.length) questions.push(...rows.filter((r) => r.role === "user").map((r) => splitImages(textOf(r.content)).text));
    const title = cleanTitle(await this.titleRunner!(TITLE_SYSTEM, titlePrompt({ questions, answers: replies })));
    if (!title) throw new Error("unreadable title");
    const source = answers >= RETITLE_AT ? "ai2" : "ai";
    if (!this.store.rename(row.id, title, source, ["auto", "hermes", "ai"])) return;
    // Hermes's own list shows it too; Hermes refuses a title another session has: then only the dashboard has it.
    await this.api.json("PATCH", `/api/sessions/${encodeURIComponent(row.sessionId)}`, { title }).catch(() => null);
  }

  async models(): Promise<ModelsList> {
    if (this.modelsCache && this.now() - this.modelsCache.at < 60_000) return this.modelsCache.value;
    const value = toModels(await this.api.json("GET", "/api/model/options"));
    this.modelsCache = { at: this.now(), value };
    return value;
  }

  /** Only a model Hermes offers for a connected provider (and only with a reasoning level when it takes one). */
  private async checkChoice(choice: ModelChoice | null): Promise<ModelChoice | null> {
    if (!choice) return null;
    const { models } = await this.models();
    const found = models.find((m) => m.provider === choice.provider && m.model === choice.model);
    if (!found) throw new ChatError("rejected", "This model is not available in Hermes.", 400);
    return found.reasoning ? choice : { ...choice, reasoning: "default" };
  }

  private conversation(viewer: Viewer, id: string): Conversation {
    const row = this.store.get(id, ownerOf(viewer));
    if (!row) throw new ChatError("not_found", "This conversation does not exist (any more).", 404);
    return row;
  }

  /**
   * A new Hermes session, untitled: Hermes wants unique titles and may title it itself after the first answer
   * (`adoptTitle`); until then the conversation shows its first words.
   */
  private async createSession(): Promise<string> {
    const answer = await this.api.json<Json>("POST", "/api/sessions", {});
    const id = ((answer.session ?? {}) as Json).id;
    if (typeof id !== "string" || !id) throw chatError("failed", "session not created");
    return id;
  }

  private async messages(sessionId: string): Promise<HermesMessage[]> {
    return messageRows(await this.api.json("GET", `/api/sessions/${encodeURIComponent(sessionId)}/messages?inline_images=false`));
  }

  private carry(row: Conversation): HermesMessage[] {
    if (!row.carry) return [];
    try {
      const value = JSON.parse(row.carry) as unknown;
      return Array.isArray(value) ? (value as HermesMessage[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * How a run stands for Hermes: its status while Hermes keeps it; once forgotten (it keeps ended runs only a short
   * while), the session's history says whether it answered. `running` when Hermes cannot be asked right now.
   */
  async outcome(run: Run): Promise<{ status: string; error: string | null; output?: string }> {
    try {
      const answer = await this.api.json<Json>("GET", `/v1/runs/${encodeURIComponent(run.id)}`);
      return { status: typeof answer.status === "string" ? answer.status : "running", error: typeof answer.error === "string" ? answer.error : null, output: typeof answer.output === "string" ? answer.output : undefined };
    } catch (failure) {
      if (!(failure instanceof ChatError && failure.code === "not_found")) return { status: "running", error: null };
    }
    const rows = await this.messages(run.sessionId).catch(() => null);
    if (rows === null) return { status: "running", error: null };
    const last = rows[rows.length - 1];
    const answered = last?.role === "assistant" && (toMsOf(last.timestamp) ?? 0) >= run.createdAt - 2_000 && textOf(last.content).trim();
    return answered ? { status: "completed", error: null, output: textOf(last!.content) } : { status: "interrupted", error: "Hermes no longer knows this answer (restarted?)." };
  }

  /** Ends a run in the store when Hermes says it is over; null then, else the run, still live. */
  async settle(run: Run): Promise<Run | null> {
    const { status, error } = await this.outcome(run);
    if (!ENDED.has(status)) return run;
    this.store.endRun(run.id, status as Exclude<RunStatus, "running">, error);
    return null;
  }

  /**
   * Ends in the store every run Hermes finished, even when nobody follows it (the person left the page): that is what
   * makes a conversation "unread" and rings the "answer ready" alert. One pass at a time.
   */
  async watchOnce(): Promise<void> {
    if (this.watching) return this.watching;
    this.watching = (async () => {
      await Promise.resolve();
      for (const run of this.store.runningRuns()) await this.settle(run).catch(() => null);
      void this.titleOnce();
    })().finally(() => {
      this.watching = null;
    });
    return this.watching;
  }

  /** Every 10 s, 20 s after boot (like the other jobs: a blue/green deploy keeps one server working). */
  startWatcher(everyMs = 10_000) {
    if (this.watchTimer || !this.api.configured) return;
    const boot = setTimeout(() => {
      void this.watchOnce();
      this.watchTimer = setInterval(() => void this.watchOnce(), everyMs);
      this.watchTimer.unref?.();
    }, 20_000);
    boot.unref?.();
  }

  async start(viewer: Viewer, input: StartInput): Promise<Started> {
    const email = ownerOf(viewer);
    if (input.images.length > MAX_IMAGES) throw new ChatError("rejected", `No more than ${MAX_IMAGES} images per message.`, 400);
    const hashes = input.images.map((image) => imageHash(image.data));
    for (const image of input.images) if (!DATA_URL.test(image.thumb) || image.thumb.length > MAX_THUMB_CHARS) throw new ChatError("rejected", "Invalid image thumbnail.", 400);
    const choice = await this.checkChoice(input.choice);
    let row = input.conversationId ? this.conversation(viewer, input.conversationId) : null;
    if (row) {
      const active = this.store.activeRun(row.id);
      if (active && (await this.settle(active))) throw new ChatError("conflict", "Hermes is already answering in this conversation: wait for the end or stop it.", 409);
    }

    let text = input.text.trim();
    let images = input.images.map((image) => image.data);
    let history: Record<string, unknown>[] | null = null;
    /** A regenerate or an edit: the turns kept, moved to a new session once its run started. */
    let kept: HermesMessage[] | null = null;
    let resent = false;
    if (input.mode !== "send") {
      if (!row) throw new ChatError("rejected", "Nothing to regenerate.", 400);
      const rows = [...this.carry(row), ...(await this.messages(row.sessionId))];
      const cut = lastUserIndex(rows);
      if (cut === -1) throw new ChatError("rejected", "Nothing to regenerate.", 400);
      const last = splitImages(textOf(rows[cut]!.content));
      if (input.mode === "regenerate") text = last.text;
      if (input.mode === "regenerate" || !input.images.length) {
        // The pictures themselves were not kept: their thumbnails go again.
        const thumbs = this.store.thumbs(email, last.hashes);
        images = last.hashes.map((hash) => thumbs.get(hash)).filter((t): t is string => Boolean(t));
        resent = true;
      }
      kept = slim(rows.slice(0, cut));
      history = toHistory(kept);
    } else if (row && this.carry(row).length) {
      // After a regenerate, the session holds only the new turns: the earlier ones go with every message.
      history = toHistory([...this.carry(row), ...(await this.messages(row.sessionId))]);
    }
    if (!text && !images.length) throw new ChatError("rejected", "The message is empty.", 400);
    if (text.length > 100_000) throw new ChatError("rejected", "The message is too long (100,000 characters at most).", 400);

    // Nothing changes here before Hermes took the run: a refusal (busy, image) leaves the conversation as it was.
    const fresh = !row || kept !== null;
    const sessionId = fresh ? await this.createSession() : row!.sessionId;
    const body: Json = {
      input: images.length ? [{ role: "user", content: [{ type: "text", text: text || "Describe this image." }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] }] : text,
      session_id: sessionId,
      instructions: `${whoLine(viewer)}\n\n${RICH_HINT}`,
    };
    if (history?.length) body.conversation_history = history;
    if (choice) {
      body.model = choice.model;
      body.provider = choice.provider;
      if (choice.reasoning !== "default") body.model_options = { reasoning: choice.reasoning === "none" ? { enabled: false } : { enabled: true, effort: choice.reasoning } };
    }
    let runId = "";
    try {
      const answer = await this.api.json<Json>("POST", "/v1/runs", body, { "X-Hermes-Session-Key": sessionKey(viewer), "Idempotency-Key": `dashboard-${randomBytes(12).toString("hex")}` });
      runId = typeof answer.run_id === "string" ? answer.run_id : "";
      if (!runId) throw chatError("failed", "no run_id");
    } catch (failure) {
      if (fresh) void this.dropSession(sessionId);
      throw failure;
    }

    let superseded: string | null = null;
    if (!row) row = this.store.create({ email, sessionId, title: autoTitle(text || "Image"), choice });
    else {
      if (kept) {
        superseded = row.sessionId;
        this.store.moveSession(row.id, sessionId, kept);
        row = { ...row, sessionId, carry: JSON.stringify(kept) };
      }
      if (input.mode === "send" || choice) this.store.setChoice(row.id, choice);
    }
    input.images.forEach((image, i) => this.store.saveImage(hashes[i]!, email, image.thumb));
    const model = choice?.model ?? (await this.models().catch(() => null))?.current?.model ?? null;
    this.store.addRun({ id: runId, conversation: row, input: text, images: resent ? resendHashes(images, email, this.store) : hashes, provider: choice?.provider ?? null, model });
    const moved = row;
    // The old session goes; a title the person gave follows the conversation (Hermes wants unique titles).
    if (superseded) void this.dropSession(superseded).then(() => (moved.titleSource === "user" ? this.api.json("PATCH", `/api/sessions/${encodeURIComponent(moved.sessionId)}`, { title: moved.title }).catch(() => null) : null));
    return { conversationId: row.id, runId, title: row.title, model };
  }

  private async dropSession(sessionId: string) {
    await this.api.json("DELETE", `/api/sessions/${encodeURIComponent(sessionId)}`).catch(() => null);
  }

  async thread(viewer: Viewer, id: string): Promise<ChatThread> {
    let row = this.conversation(viewer, id);
    const email = ownerOf(viewer);
    let active = this.store.activeRun(row.id);
    if (active) active = await this.settle(active);
    const runs = this.store.runs(row.id);
    const fallback = row.model;
    const modelAt = (at: number | null) => {
      if (at === null) return null;
      const run = [...runs].reverse().find((r) => r.createdAt - 2_000 <= at && at <= (r.endedAt ?? Infinity) + 10_000);
      return run?.model ?? fallback;
    };
    let partial = false;
    let rows: HermesMessage[] = this.carry(row);
    try {
      rows = [...rows, ...(await this.messages(row.sessionId))];
      row = await this.adoptTitle(row);
    } catch {
      partial = true;
    }
    const hashes = rows.flatMap((r) => (r.role === "user" ? splitImages(textOf(r.content)).hashes : []));
    const thumbs = this.store.thumbs(email, hashes);
    let items = toItems(rows, { thumb: (hash) => thumbs.get(hash) ?? "", modelAt });
    let live: ActiveRun | null = null;
    if (active) {
      // What Hermes already wrote of the live turn is drawn from its events instead.
      const since = active.createdAt - 2_000;
      const cut = items.findIndex((item) => item.role === "user" && item.at !== null && item.at >= since);
      if (cut !== -1) items = items.slice(0, cut);
      const imgs = parseJsonList(active.images);
      const runThumbs = this.store.thumbs(email, imgs);
      live = { id: active.id, input: active.input, images: imgs.map((h) => runThumbs.get(h) ?? ""), model: active.model, createdAt: active.createdAt, eta: this.store.etaOf(active) };
    }
    // A stopped or failed last run says so under its turn.
    const lastRun = runs[runs.length - 1];
    if (!active && lastRun && lastRun.status !== "completed" && lastRun.status !== "running") {
      const tail = items[items.length - 1];
      const status = lastRun.status as "failed" | "cancelled" | "interrupted";
      if (tail?.role === "assistant" && (tail.at ?? 0) >= lastRun.createdAt - 2_000) items[items.length - 1] = { ...tail, status, error: lastRun.error ?? undefined };
      else if (tail?.role === "user") items.push({ role: "assistant", id: `end-${lastRun.id}`, parts: [], model: lastRun.model, at: lastRun.endedAt, status, error: lastRun.error ?? undefined });
    }
    return { id: row.id, title: row.title, archivedAt: row.archivedAt ?? null, items, choice: choiceOf(row), active: live, partial };
  }

  /**
   * Any Hermes session, read only (from the Conversations page): a session of the viewer's own Chat answers with its
   * conversation instead, so the page opens it there and it can go on.
   */
  async readSession(viewer: Viewer, sessionId: string): Promise<{ conversationId: string } | ReadOnlyThread> {
    const own = this.store.bySession(sessionId, ownerOf(viewer));
    if (own) return { conversationId: own.id };
    // Another person's chat stays theirs, even read only.
    if (this.store.sessionOwners(sessionId).length) throw new ChatError("not_found", "This conversation does not exist (any more).", 404);
    const answer = await this.api.json<Json>("GET", `/api/sessions/${encodeURIComponent(sessionId)}`);
    const session = (answer.session ?? {}) as Json;
    const rows = await this.messages(sessionId);
    const items = toItems(rows, { thumb: () => "", modelAt: () => null });
    const title = (typeof session.title === "string" && session.title.trim()) || "Untitled conversation";
    const source = typeof session.source === "string" ? session.source : "";
    return { sessionId, title, source, items };
  }

  /** Hermes titles a session on its own after the first answer: an automatic title takes it. */
  private async adoptTitle(row: Conversation): Promise<Conversation> {
    if (row.titleSource !== "auto") return row;
    const answer = await this.api.json<Json>("GET", `/api/sessions/${encodeURIComponent(row.sessionId)}`).catch(() => null);
    const title = typeof (answer?.session as Json | undefined)?.title === "string" ? ((answer!.session as Json).title as string).trim() : "";
    if (!title || title === row.title || title.startsWith(row.title.replace(/…$/, ""))) return row;
    if (!this.store.rename(row.id, title.slice(0, 120), "hermes", ["auto"])) return row;
    return { ...row, title: title.slice(0, 120), titleSource: "hermes" };
  }

  async rename(viewer: Viewer, id: string, title: string) {
    const row = this.conversation(viewer, id);
    const clean = title.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!clean) throw new ChatError("rejected", "The title is empty.", 400);
    this.store.rename(row.id, clean, "user");
    // Hermes's own list (Conversations) shows the same title; a refusal there does not undo it here.
    await this.api.json("PATCH", `/api/sessions/${encodeURIComponent(row.sessionId)}`, { title: clean }).catch(() => null);
    return { title: clean };
  }

  async remove(viewer: Viewer, id: string) {
    const row = this.conversation(viewer, id);
    const active = this.store.activeRun(row.id);
    if (active) await this.api.json("POST", `/v1/runs/${encodeURIComponent(active.id)}/stop`, {}).catch(() => null);
    for (const sessionId of this.store.sessions(row)) {
      try {
        await this.api.json("DELETE", `/api/sessions/${encodeURIComponent(sessionId)}`);
      } catch (failure) {
        // Already gone is fine; Hermes down is not (the conversation stays so it can be deleted again).
        if (!(failure instanceof ChatError && failure.code === "not_found")) {
          if (failure instanceof ChatError && failure.code === "conflict") continue;
          throw failure;
        }
      }
    }
    this.store.remove(row.id);
  }

  private ownedRun(viewer: Viewer, runId: string): Run {
    const run = this.store.run(runId, ownerOf(viewer));
    if (!run) throw new ChatError("not_found", "This answer does not exist (any more).", 404);
    return run;
  }

  async stop(viewer: Viewer, runId: string) {
    const run = this.ownedRun(viewer, runId);
    try {
      await this.api.json("POST", `/v1/runs/${encodeURIComponent(run.id)}/stop`, {});
    } catch (failure) {
      // A run that just ended cannot be stopped any more: that is what was wanted.
      if (!(failure instanceof ChatError && (failure.code === "conflict" || failure.code === "not_found"))) throw failure;
    }
    return { ok: true };
  }

  async approve(viewer: Viewer, runId: string, input: { promptId: string; generation: number; choice: "once" | "deny" }) {
    const run = this.ownedRun(viewer, runId);
    return this.api.json("POST", `/v1/runs/${encodeURIComponent(run.id)}/approval`, { request_id: input.promptId, execution_generation: input.generation, choice: input.choice });
  }

  async clarify(viewer: Viewer, runId: string, input: { promptId: string; generation: number; answer: string }) {
    const run = this.ownedRun(viewer, runId);
    return this.api.json("POST", `/v1/runs/${encodeURIComponent(run.id)}/clarify`, { request_id: input.promptId, execution_generation: input.generation, answer: input.answer });
  }

  /**
   * The run's events as SSE, from after `after`. The browser leaving only detaches the relay (Hermes keeps running
   * the turn; only Stop ends it). When Hermes no longer streams the run, its final status is sent as one event.
   */
  async events(viewer: Viewer, runId: string, after: number | null, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const run = this.ownedRun(viewer, runId);
    const upstreamAbort = new AbortController();
    const detach = () => upstreamAbort.abort();
    signal.addEventListener("abort", detach, { once: true });
    let upstream: Response | null = null;
    try {
      upstream = await this.api.events(run.id, after, upstreamAbort.signal);
    } catch (failure) {
      if (!(failure instanceof ChatError && failure.code === "not_found")) throw failure;
    }
    const store = this.store;
    // Not streamed any more: its end as one event, or nothing while it still runs (the page retries).
    const final = upstream ? null : await this.finalEvent(run);
    const silent = !upstream && !final;
    const encoder = new TextEncoder();
    let closed = false;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            closed = true;
          }
        };
        const close = () => {
          if (keepalive) clearInterval(keepalive);
          signal.removeEventListener("abort", detach);
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // Already cancelled by the browser.
          }
        };
        // Hermes's "⏱️ ~N min left" lines: the latest one is kept on the run (list countdown, a page opened later).
        const eta = etaTracker(run.etaSeconds);
        const forward = (event: RunEvent) => {
          const chunk = event.event === "message.delta" ? event.delta : event.event === "message.interim" && event.already_streamed !== true ? `\n${typeof event.text === "string" ? event.text : ""}\n` : null;
          if (typeof chunk === "string") {
            const seconds = eta(chunk);
            if (seconds !== null) store.setEta(run.id, seconds);
          }
          const status = TERMINAL_EVENTS[event.event];
          if (status) store.endRun(run.id, status, typeof event.error === "string" ? event.error : null);
          send(`${typeof event.seq === "number" ? `id: ${event.seq}\n` : ""}data: ${JSON.stringify(event)}\n\n`);
        };
        send(": open\n\n");
        if (final || silent) {
          if (final) forward(final);
          return close();
        }
        // Proxies drop a silent connection: a comment every 15 s keeps it open.
        keepalive = setInterval(() => send(": keepalive\n\n"), 15_000);
        keepalive.unref?.();
        const parse = sseParser();
        const decoder = new TextDecoder();
        const reader = upstream!.body!.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const frame of parse(decoder.decode(value, { stream: true }))) {
              const event = frameEvent(frame);
              if (event) forward(event);
            }
          }
        } catch {
          // The browser left (abort) or Hermes dropped the stream: the page reconnects after its last event.
        }
        close();
      },
      cancel() {
        closed = true;
        if (keepalive) clearInterval(keepalive);
        detach();
      },
    });
  }

  /** Hermes no longer streams this run: how it ended, or null while it still runs (the page asks again a bit later). */
  private async finalEvent(run: Run): Promise<RunEvent | null> {
    const { status, error, output } = await this.outcome(run);
    if (!ENDED.has(status)) return null;
    return { event: `run.${status}`, ...(output !== undefined ? { output } : {}), ...(error ? { error } : {}) };
  }
}

function parseJsonList(value: string): string[] {
  try {
    const list = JSON.parse(value) as unknown;
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** For a regenerate, the resent thumbnails keep the hashes they are stored under. */
function resendHashes(images: string[], email: string, store: ChatStore): string[] {
  return images.map((url) => {
    const hash = imageHash(url);
    store.saveImage(hash, email, url);
    return hash;
  });
}
