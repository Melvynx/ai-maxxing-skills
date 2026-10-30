import { toMs, type Json } from "@/server/hermes";

/** One line of the Conversations page, built from a Hermes session. */
export interface Conversation {
  id: string;
  title: string;
  /** Where it happened: telegram, discord, cli, oneshot, cron... */
  source: string;
  /** Who it was with, when the chat platform names them. */
  who: string | null;
  messages: number;
  lastActive: number | null;
  active: boolean;
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Turns `/api/sessions` into the page's list: newest activity first, hidden and archived sessions left out. */
export function toConversations(data: unknown): Conversation[] {
  const sessions = Array.isArray((data as Json | null)?.sessions) ? ((data as Json).sessions as Json[]) : [];
  return sessions
    .filter((s) => s && typeof s === "object" && !s.hidden && s.archived !== true)
    .map((s) => ({
      id: str(s.id),
      title: str(s.title) || str(s.preview) || "Untitled conversation",
      source: str(s.source) || "unknown",
      who: str(s.display_name) || null,
      messages: typeof s.message_count === "number" ? s.message_count : 0,
      lastActive: toMs(s.last_active) ?? toMs(s.ended_at) ?? toMs(s.started_at),
      active: s.is_active === true,
    }))
    .filter((c) => c.id)
    .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
}
