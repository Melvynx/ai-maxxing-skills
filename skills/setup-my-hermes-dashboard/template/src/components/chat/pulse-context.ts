import * as React from "react";

import type { ChatUnread } from "@/lib/chat/items";

/**
 * The Chat's unread answers, shared by the admins' layout (ChatPulseProvider in pulse.tsx polls them), the sidebar
 * badge and the Chat page. Its own module, with no server import, so the sidebar and its tests stay light.
 */
export type ChatPulseState = { unread: ChatUnread[]; refresh: () => void };

export const ChatPulseContext = React.createContext<ChatPulseState>({ unread: [], refresh: () => undefined });

export const useChatPulse = () => React.useContext(ChatPulseContext);

/** Ask the layout to poll now (after a message is sent or a conversation is read). */
export const CHAT_PULSE_EVENT = "dashboard-chat-pulse";
export const refreshChatPulse = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHAT_PULSE_EVENT));
};

/** Which unread answers are new to this browser (by conversation + end time); remembers all of them. Exported for the test. */
export function newAnswers(unread: ChatUnread[], seen: string[] | null): { fresh: ChatUnread[]; seen: string[] } {
  const keys = unread.map((u) => `${u.id}:${u.endedAt}`);
  if (seen === null) return { fresh: [], seen: keys };
  const known = new Set(seen);
  const fresh = unread.filter((u) => !known.has(`${u.id}:${u.endedAt}`));
  return { fresh, seen: [...seen, ...fresh.map((u) => `${u.id}:${u.endedAt}`)].slice(-300) };
}

/** « Hermes is done » / « Hermes stopped » for a run's end. */
export const endLabel = (status: string) => (status === "completed" ? "Hermes is done" : "Hermes stopped");
