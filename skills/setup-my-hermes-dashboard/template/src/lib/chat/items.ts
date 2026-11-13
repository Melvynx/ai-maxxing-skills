import type { Eta } from "@/lib/chat/eta";
import type { Part, TurnStatus } from "@/lib/chat/events";

/** What the thread shows, from a conversation's history (src/server/chat/history.ts) or a live run. */
export type UserItem = {
  role: "user";
  id: string;
  text: string;
  /** Thumbnails (data URLs) of the images sent with it; "" for an image whose thumbnail is gone. */
  images: string[];
  /** Milliseconds. */
  at: number | null;
};

export type AssistantItem = {
  role: "assistant";
  id: string;
  parts: Part[];
  /** The model that answered, when the dashboard started that run. */
  model: string | null;
  at: number | null;
  /** Only for a turn that did not end well (a stopped or failed run kept in the history). */
  status?: TurnStatus;
  error?: string;
};

export type ChatItem = UserItem | AssistantItem;

/** A conversation in the list. */
export type ChatSummary = {
  id: string;
  title: string;
  updatedAt: number;
  running: boolean;
  /** An answer ended since its owner last looked. */
  unread?: boolean;
  /** Put away by its owner (« Archives »): out of the list, still readable; a new message brings it back. */
  archivedAt?: number | null;
  /** While it runs: Hermes's wait estimate, else the usual duration of this person's answers (« ⏱️ ~3 min »). */
  eta?: Eta | null;
  /** While it runs: when the live run started (ms). */
  startedAt?: number | null;
};

/** A conversation whose answer ended while its owner was elsewhere (the Chat badge and the « Hermes is done » alert). */
export type ChatUnread = { id: string; title: string; endedAt: number; status: string };

/** A model the composer can pick: a connected provider's model. */
export type ChatModel = {
  provider: string;
  providerName: string;
  model: string;
  /** The model takes a reasoning level (`model_options.reasoning`). */
  reasoning: boolean;
  /** Hermes's warning (input > $20/M or output > $100/M), when its prices are known. */
  expensive: string | null;
};

export type ModelChoice = { provider: string; model: string; reasoning: Reasoning };

/** « Thinking »: Hermes's default, or a level sent as `model_options.reasoning`. */
export const REASONING = ["default", "none", "low", "medium", "high"] as const;
export type Reasoning = (typeof REASONING)[number];
export const REASONING_LABELS: Record<Reasoning, string> = { default: "Auto", none: "Off", low: "Light", medium: "Medium", high: "Deep" };

/** The live run of a conversation, for the page to attach to after a reload. */
export type ActiveRun = { id: string; input: string; images: string[]; model: string | null; createdAt: number; /** Its wait estimate as stored (see ChatSummary.eta). */ eta?: Eta | null };

export type ChatThread = {
  id: string;
  title: string;
  archivedAt?: number | null;
  items: ChatItem[];
  /** The conversation's model choice (null: Hermes's main model). */
  choice: ModelChoice | null;
  active: ActiveRun | null;
  /** The history could not be read (Hermes stopped): the thread shows what it can. */
  partial: boolean;
};
