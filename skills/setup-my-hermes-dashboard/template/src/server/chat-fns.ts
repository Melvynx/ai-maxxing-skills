import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { ChatSummary, ChatThread, ChatUnread } from "@/lib/chat/items";
import { getApp } from "@/server/app";
import { ownerOf, type ModelsList, type ReadOnlyThread } from "@/server/chat/chat";
import { orNull } from "@/server/functions";
import { adminOrNull, getViewer, requireAdmin } from "@/server/viewer";

/**
 * The Chat page's reads and changes (sending, stopping and the live stream go through src/routes/api/hermes-chat).
 * Admins only: Hermes can reach the server and every tool it has. Each person sees their own conversations.
 */

export type Skill = { name: string; description: string };

export type ChatPage = {
  /** HERMES_API_SERVER_KEY is set. */
  configured: boolean;
  conversations: ChatSummary[];
  thread: ChatThread | null;
  /** Why the conversation of `?c=` could not open (gone, Hermes down). */
  threadError: string | null;
  /** null: Hermes's API Server does not answer. */
  models: ModelsList | null;
  /** A few of Hermes's skills, for the empty screen. */
  skills: Skill[];
  /** `?s=`: a Hermes session from another place (Telegram, the terminal…), shown read only; `open` when it is one of the viewer's own conversations. */
  readOnly: ReadOnlyThread | null;
  open: string | null;
};

const Id = z.string().regex(/^c_[0-9a-f]{16}$/);

let skillsCache: { at: number; value: Skill[] } | null = null;

async function readSkills(): Promise<Skill[]> {
  if (skillsCache && Date.now() - skillsCache.at < 10 * 60_000) return skillsCache.value;
  const { chat, hermes } = getApp();
  // The API Server's /v1/skills, else the Hermes dashboard's list.
  const raw = (await orNull(chat.api.json<unknown>("GET", "/v1/skills"))) ?? (await orNull(hermes.api<unknown>("/api/skills")));
  const rows = (Array.isArray(raw) ? raw : Array.isArray((raw as { data?: unknown } | null)?.data) ? (raw as { data: unknown[] }).data : []) as Record<string, unknown>[];
  const value = rows
    .filter((r) => r && typeof r.name === "string" && r.enabled !== false)
    .sort((a, b) => Number(b.usage ?? 0) - Number(a.usage ?? 0))
    .slice(0, 8)
    .map((r) => ({ name: String(r.name), description: typeof r.description === "string" ? r.description : "" }));
  skillsCache = { at: Date.now(), value };
  return value;
}

/** Null for a member (the page says the Chat is for admins). */
export const getChatPage = createServerFn({ method: "GET" })
  .validator(z.object({ c: Id.optional(), s: z.string().regex(/^[\w.:-]{1,128}$/).optional() }))
  .handler(async ({ data }): Promise<ChatPage | null> => {
    const viewer = await adminOrNull();
    if (!viewer) return null;
    const { chat } = getApp();
    const configured = chat.api.configured;
    let thread: ChatThread | null = null;
    let threadError: string | null = null;
    if (data.c && configured) {
      try {
        thread = await chat.thread(viewer, data.c);
      } catch (error) {
        threadError = error instanceof Error ? error.message : "Conversation not found.";
      }
    }
    let readOnly: ReadOnlyThread | null = null;
    let open: string | null = null;
    if (data.s && !data.c && configured) {
      try {
        const read = await chat.readSession(viewer, data.s);
        if ("conversationId" in read) open = read.conversationId;
        else readOnly = read;
      } catch (error) {
        threadError = error instanceof Error ? error.message : "Session not found.";
      }
    }
    const [models, skills] = await Promise.all([
      configured ? orNull(chat.models()) : null,
      data.c || data.s || !configured ? [] : readSkills().catch(() => []),
    ]);
    return { configured, conversations: chat.store.list(ownerOf(viewer)), thread, threadError, models, skills, readOnly, open };
  });

/** The list alone, after a message (a new conversation, a new title, the running dot). */
export const listChats = createServerFn({ method: "GET" }).handler(async (): Promise<ChatSummary[]> => {
  const viewer = await requireAdmin();
  return getApp().chat.store.list(ownerOf(viewer));
});

/** One conversation again, once its run has ended (the history replaces the live turn). */
export const getChatThread = createServerFn({ method: "GET" })
  .validator(z.object({ id: Id }))
  .handler(async ({ data }): Promise<ChatThread> => getApp().chat.thread(await requireAdmin(), data.id));

export const renameChat = createServerFn({ method: "POST" })
  .validator(z.object({ id: Id, title: z.string().trim().min(1).max(120) }))
  .handler(async ({ data }) => getApp().chat.rename(await requireAdmin(), data.id, data.title));

/** Into the Archives (`archived: true`) or back into the list. */
export const archiveChat = createServerFn({ method: "POST" })
  .validator(z.object({ id: Id, archived: z.boolean() }))
  .handler(async ({ data }) => {
    const viewer = await requireAdmin();
    const { store } = getApp().chat;
    if (!store.get(data.id, ownerOf(viewer))) throw new Error("This conversation does not exist (any more).");
    store.setArchived(data.id, ownerOf(viewer), data.archived);
    return { ok: true };
  });

/** Deletes the conversation here and its Hermes sessions (stopping its run first). */
export const deleteChat = createServerFn({ method: "POST" })
  .validator(z.object({ id: Id }))
  .handler(async ({ data }) => {
    await getApp().chat.remove(await requireAdmin(), data.id);
    return { ok: true };
  });

/** The viewer's conversations with an answer ended since they last looked (badge, dot, « Hermes is done »). Null for a member. */
export const getChatPulse = createServerFn({ method: "GET" }).handler(async (): Promise<ChatUnread[] | null> => {
  // Polled by every page: a signed-out tab just gets nothing (no error toast).
  const viewer = await getViewer();
  if (viewer?.role !== "admin") return null;
  return getApp().chat.store.unread(ownerOf(viewer));
});

/** The person has the conversation on screen: its answer is read. */
export const markChatSeen = createServerFn({ method: "POST" })
  .validator(z.object({ id: Id }))
  .handler(async ({ data }) => {
    const viewer = await requireAdmin();
    getApp().chat.store.markSeen(data.id, ownerOf(viewer));
    return { ok: true };
  });
