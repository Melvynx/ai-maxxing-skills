import { useNavigate, useRouter } from "@tanstack/react-router";
import { Archive, ArchiveRestore, ArrowDown, MoreHorizontal, PanelLeft, Pencil, RefreshCw, SquarePen, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useStickToBottom } from "use-stick-to-bottom";

import { SectionMark } from "@/components/brand";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { frameEvent, isOver, newTurn, reduceTurn, sseParser, type ApprovalPart, type ClarifyPart, type Turn } from "@/lib/chat/events";
import { APPROVAL_SSE, CLARIFY_SSE, FAILED_SSE } from "@/lib/chat/fixtures";
import type { ChatItem, ModelChoice } from "@/lib/chat/items";
import type { ChatSearch } from "@/lib/chat/search";
import { cn } from "@/lib/utils";
import type { ChatPage } from "@/server/chat-fns";
import { archiveChat, deleteChat, markChatSeen, renameChat } from "@/server/chat-fns";

import { Composer } from "./composer";
import { ConversationList, DeleteDialog, TitleInput } from "./conversations";
import { useLiveEta } from "./eta";
import type { Attachment } from "./images";
import { refreshChatPulse, useChatPulse } from "./pulse-context";
import { AssistantTurn, UserMessage } from "./thread";
import { postJson, useRunStream } from "./use-run";

/**
 * The Chat page: the person's conversations on the left (a sheet on a phone), the thread in the middle (48rem), the
 * composer at the bottom. A message starts a Hermes run; its events stream into the thread; a reload, or another
 * device, finds the run where it is (the loader says which run is live and the stream replays it).
 */

type Live = {
  /** null while a new conversation is being made (the URL has no `c` yet). */
  conversationId: string | null;
  /** The conversation it goes to, once Hermes took the run. */
  target?: string;
  runId: string | null;
  user: { text: string; images: string[]; at?: number | null };
  model: string | null;
  mode: "send" | "regenerate" | "edit";
};

type Started = { conversationId: string; runId: string; title: string; model: string | null };

export const SUGGESTIONS = [
  { title: "How is the server doing?", text: "How is the server doing? Show the load, memory and disk as stats, and the disk use by folder as a chart." },
  { title: "What did you do this week?", text: "What did you do for me this week? Group it by day." },
  { title: "Build me a small tool", text: "Build me a live HTML page: a Pomodoro timer I can use right here in the chat." },
  { title: "What can you do?", text: "What can you do for me? List your most useful skills with one example each." },
];

const DEMO: Record<string, { text: string; sse: string }> = {
  approval: { text: "Check the disk space and clean the build cache.", sse: APPROVAL_SSE },
  clarify: { text: "Make me the sales report.", sse: CLARIFY_SSE },
  failed: { text: "Search the web for the sales report.", sse: FAILED_SSE },
};

const SOURCES: Record<string, string> = { api_server: "Hermes's API", cli: "the terminal (CLI)", tui: "the terminal", cron: "a scheduled task", telegram: "Telegram", discord: "Discord", slack: "Slack", whatsapp: "WhatsApp", desktop: "the Hermes app" };
export const sourceName = (source: string) => SOURCES[source] ?? (source || "somewhere else");

function demoTurn(sse: string): Turn {
  let turn = newTurn("run_fixture0001", "running");
  for (const frame of sseParser()(sse)) {
    const event = frameEvent(frame);
    if (event) turn = reduceTurn(turn, event);
  }
  return turn;
}

function Welcome({ skills, onPick }: { skills: ChatPage["skills"]; onPick: (text: string) => void }) {
  return (
    <div className="grid content-center justify-items-center gap-6 text-center" data-testid="chat-empty">
      <SectionMark section="chat" className="size-9 sm:size-11" />
      <div className="grid gap-1.5">
        <h2 className="font-heading text-2xl font-semibold tracking-[-0.02em] sm:text-display">What are we doing today?</h2>
        <p className="text-sm text-muted-foreground">Hermes, with its memory, skills and tools. It can act on the server and answer with charts, stats and live pages.</p>
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.text)}
            className="grid gap-0.5 rounded-xl border bg-card px-4 py-2.5 text-left shadow-panel sm:py-3 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="chat-suggestion"
          >
            <span className="text-sm font-medium">{s.title}</span>
            <span className="hidden truncate text-xs text-muted-foreground sm:block">{s.text}</span>
          </button>
        ))}
      </div>
      {skills.length ? (
        <div className="hidden justify-items-center gap-2 sm:grid" data-testid="chat-skills">
          <span className="text-xs text-muted-foreground">A few of Hermes's skills</span>
          <ul className="flex flex-wrap justify-center gap-1.5">
            {skills.map((skill) => (
              <li key={skill.name}>
                <button type="button" title={skill.description} onClick={() => onPick(`With the ${skill.name} skill: `)} className="rounded-full border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground outline-none hover:border-brand/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  {skill.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const NO_PARTS: Turn["parts"] = [];

export function ChatView({ data, search }: { data: ChatPage; search: ChatSearch }) {
  const navigate = useNavigate({ from: "/chat" });
  const router = useRouter();
  const current = search.c ?? null;
  const thread = data.thread && data.thread.id === current ? data.thread : null;
  const q = search.q ?? "";

  const [choice, setChoice] = React.useState<ModelChoice | null>(thread?.choice ?? null);
  const [live, setLive] = React.useState<Live | null>(() =>
    thread?.active ? { conversationId: thread.id, runId: thread.active.id, user: { text: thread.active.input, images: thread.active.images }, model: thread.active.model, mode: "send" } : null,
  );
  const [stopping, setStopping] = React.useState(false);
  const [preset, setPreset] = React.useState<{ text: string; at: number } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  /** The conversation whose title is edited in place (list row or header). */
  const [editing, setEditing] = React.useState<string | null>(null);
  /** The header's title is edited (one field at a time: the list row of the same conversation stays a link). */
  const [editingHeader, setEditingHeader] = React.useState(false);
  // What the person just changed shows at once; the loader catches up (and the override goes once it agrees).
  const [titles, setTitles] = React.useState<Record<string, string>>({});
  const [archivedOv, setArchivedOv] = React.useState<Record<string, number | null>>({});
  const composer = React.useRef<HTMLTextAreaElement>(null);
  const retries = React.useRef(0);
  const dataRef = React.useRef(data);
  dataRef.current = data;
  /** The run that just ended and the history the page had then: a newer history replaces the live turn in the same frame. */
  const [endedWith, setEndedWith] = React.useState<{ runId: string; thread: ChatPage["thread"] } | null>(null);

  const streamed = useRunStream(live?.runId ?? null, null, (ended) => {
    setEndedWith({ runId: ended.runId, thread: dataRef.current.thread });
    setStopping(false);
    void router.invalidate();
    // The server writes a smart title a few seconds after an answer (see Chat.titleOnce): pick it up.
    for (const ms of [15_000, 40_000]) setTimeout(() => void router.invalidate(), ms);
  });

  // Only the turn of the live run (for one render after a new send, the hook still holds the previous one).
  const turn = streamed && live && streamed.runId === live.runId ? streamed : null;
  // The history read after the end has the exchange: drawing the live copy too would show it twice for a frame.
  const lastItem = thread?.items[thread.items.length - 1];
  const settled = Boolean(live && turn && isOver(turn) && thread && !thread.active && endedWith?.runId === live.runId && thread !== endedWith.thread && lastItem?.role === "assistant");

  // Another conversation: its own model choice, and the live run of this one is left to Hermes.
  const shownFor = React.useRef(current);
  React.useEffect(() => {
    if (shownFor.current === current) return;
    shownFor.current = current;
    setChoice(thread?.choice ?? null);
    setLive((l) => (l && l.conversationId !== current && l.conversationId !== null ? null : l));
    setStopping(false);
    setEditingHeader(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // The loader is the truth once it answers: a live run to follow, or the history that replaces the ended one.
  React.useEffect(() => {
    if (!thread) return;
    const active = thread.active;
    if (active) {
      if (live?.runId !== active.id) setLive({ conversationId: thread.id, runId: active.id, user: { text: active.input, images: active.images }, model: active.model, mode: "send" });
    } else if (live && live.runId && live.conversationId === thread.id && turn && isOver(turn)) {
      // Hermes may write the answer to its history a moment after the end: until it is there, keep the live copy and ask again.
      if (thread.items[thread.items.length - 1]?.role === "assistant" || retries.current >= 4) {
        retries.current = 0;
        setLive(null);
      } else {
        retries.current += 1;
        const timer = setTimeout(() => void router.invalidate(), 800 * retries.current);
        return () => clearTimeout(timer);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const running = Boolean(live && (live.runId === null || !turn || !isOver(turn)));
  // The wait estimate of the live run: what Hermes just wrote, else what the server holds (its estimate or the usual time).
  const liveConv = live ? (live.target ?? live.conversationId) : null;
  const storedEta = live?.runId && thread?.active?.id === live.runId ? thread.active.eta : data.conversations.find((c) => c.id === liveConv && c.running)?.eta;
  const liveEta = useLiveEta(live?.runId ?? null, turn?.parts ?? NO_PARTS, storedEta);
  const shownLive = !settled && live && (live.conversationId === current || (live.conversationId === null && (current === null || live.target === current))) ? live : null;

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({ resize: "smooth", initial: "instant" });
  // A conversation opens at its end (also right after the page loads, once the thread has its height).
  React.useEffect(() => {
    const jump = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      void scrollToBottom("instant");
    };
    jump();
    const frame = requestAnimationFrame(jump);
    const timer = setTimeout(jump, 120);
    return () => (cancelAnimationFrame(frame), clearTimeout(timer));
  }, [current, thread?.id, scrollToBottom, scrollRef]);

  // The open conversation is read once its answer is over and the tab is in front: no dot, no badge, no alert for it.
  const pulse = useChatPulse();
  const pending = Boolean(current && (data.conversations.some((c) => c.id === current && c.unread) || pulse.unread.some((u) => u.id === current)));
  React.useEffect(() => {
    if (!current || !thread || running) return;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      void markChatSeen({ data: { id: current } })
        .then(() => refreshChatPulse())
        .catch(() => undefined);
    };
    // Once when it opens or its answer ends, again when the person comes back to the tab.
    mark();
    const onVisible = () => mark();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, thread?.id, running, pending]);

  // The list follows the pulse between two loads: an answer ended elsewhere gets its dot without a reload.
  const conversations = React.useMemo(() => {
    const ended = new Set(pulse.unread.map((u) => u.id));
    return data.conversations.map((c) => {
      let row = ended.has(c.id) ? { ...c, running: false, unread: true } : c;
      if (titles[c.id] !== undefined) row = { ...row, title: titles[c.id]! };
      if (c.id in archivedOv) row = { ...row, archivedAt: archivedOv[c.id] ?? null };
      // The run this page follows: the list counts down with the estimate Hermes just wrote.
      if (row.running && running && c.id === liveConv && liveEta) row = { ...row, eta: liveEta };
      return row;
    });
  }, [data.conversations, pulse.unread, titles, archivedOv, running, liveConv, liveEta]);
  // An override goes once the server says the same.
  React.useEffect(() => {
    setTitles((t) => {
      const keep = Object.fromEntries(Object.entries(t).filter(([id, title]) => data.conversations.find((c) => c.id === id)?.title !== title && data.conversations.some((c) => c.id === id)));
      return Object.keys(keep).length === Object.keys(t).length ? t : keep;
    });
    setArchivedOv((a) => {
      const keep = Object.fromEntries(Object.entries(a).filter(([id, at]) => data.conversations.some((c) => c.id === id && Boolean(c.archivedAt) !== Boolean(at))));
      return Object.keys(keep).length === Object.keys(a).length ? a : keep;
    });
  }, [data.conversations]);

  const unavailable = !data.configured ? "The chat is not set up on this server yet (Hermes's API Server key is missing)." : data.models === null ? "Hermes does not answer. It may be stopped or restarting." : null;

  const readOnly = !current && data.readOnly && data.readOnly.sessionId === search.s ? data.readOnly : null;
  // A session of this person's Chat, opened from Conversations: it opens as their conversation, to go on with it.
  React.useEffect(() => {
    if (data.open && !current) void navigate({ search: (s) => ({ ...s, c: data.open!, s: undefined }), replace: true });
  }, [data.open, current, navigate]);

  let items: ChatItem[] = thread?.items ?? readOnly?.items ?? [];
  // A regenerate or an edit replaces the last exchange at once, before the history comes back.
  if (shownLive && shownLive.mode !== "send" && !thread?.active) {
    const cut = items.map((i) => i.role).lastIndexOf("user");
    if (cut !== -1) items = items.slice(0, cut);
  }
  const demo = import.meta.env.DEV && search.demo ? DEMO[search.demo] : undefined;
  const lastUser = items.map((i) => i.role).lastIndexOf("user");

  const send = async (text: string, images: Attachment[], mode: Live["mode"] = "send", shown?: Live["user"]): Promise<boolean> => {
    if (running || unavailable) return false;
    // A long task ends while the person is elsewhere: the browser may tell them (asked once, on this click).
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
    const from = current;
    setLive({ conversationId: from, runId: null, user: { ...(shown ?? { text, images: images.map((i) => i.thumb) }), at: Date.now() }, model: choice?.model ?? data.models?.current?.model ?? null, mode });
    void scrollToBottom("smooth");
    try {
      const started = await postJson<Started>("/api/hermes-chat/runs", { conversationId: from, text, images: images.map(({ data: d, thumb }) => ({ data: d, thumb })), choice, mode });
      setLive((l) => (l ? { ...l, target: started.conversationId, runId: started.runId, model: started.model } : l));
      if (!from) {
        // Opens the new conversation, unless the person went to another one meanwhile.
        if (shownFor.current === null) await navigate({ search: (s) => ({ ...s, c: started.conversationId }), replace: true });
        setLive((l) => (l && l.runId === started.runId ? { ...l, conversationId: started.conversationId } : l));
      } else void router.invalidate();
      refreshChatPulse();
      return true;
    } catch (error) {
      setLive(null);
      toast.error(error instanceof Error ? error.message : "The message was not sent.");
      return false;
    }
  };

  const regenerate = () => {
    const user = items[lastUser];
    if (user?.role !== "user") return;
    void send("", [], "regenerate", { text: user.text, images: user.images });
  };
  const edit = (text: string) => {
    const user = items[lastUser];
    void send(text, [], "edit", { text, images: user?.role === "user" ? user.images : [] });
  };

  const stop = React.useCallback(async () => {
    if (!live?.runId || stopping) return;
    setStopping(true);
    try {
      await postJson(`/api/hermes-chat/runs/${live.runId}/stop`, {});
    } catch (error) {
      setStopping(false);
      toast.error(error instanceof Error ? error.message : "Could not stop the answer.");
    }
  }, [live?.runId, stopping]);

  const control = async (path: string, body: unknown) => {
    if (demo) return void toast.info("Preview: nothing is sent to Hermes.");
    if (!live?.runId) return;
    try {
      await postJson(`/api/hermes-chat/runs/${live.runId}/${path}`, body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hermes did not take the answer.");
    }
  };
  const approve = (part: ApprovalPart, value: "once" | "deny") => control("approval", { promptId: part.promptId, generation: part.generation, choice: value });
  const clarify = (part: ClarifyPart, answer: string) => control("clarify", { promptId: part.promptId, generation: part.generation, answer });

  const newChat = React.useCallback(() => {
    void navigate({ search: (s) => ({ q: s.q, view: s.view }) });
    setPreset(null);
    requestAnimationFrame(() => composer.current?.focus());
  }, [navigate]);

  // Ctrl/Cmd+K: a new conversation. Escape: stop the answer (when no dialog is open).
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        newChat();
      } else if (
        event.key === "Escape" &&
        running &&
        !event.defaultPrevented &&
        !(event.target instanceof Element && event.target.closest("[data-testid=chat-clarify],[data-testid=chat-edit]")) &&
        !document.querySelector("[role=dialog],[role=alertdialog],[data-radix-popper-content-wrapper]")
      ) {
        void stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat, running, stop]);

  const rename = (id: string, title: string) => {
    const before = conversations.find((c) => c.id === id)?.title ?? thread?.title ?? "";
    setTitles((t) => ({ ...t, [id]: title }));
    renameChat({ data: { id, title } }).catch((error: unknown) => {
      setTitles((t) => ({ ...t, [id]: before }));
      toast.error(error instanceof Error ? error.message : "Could not rename.");
    });
  };
  const archive = (id: string, archived: boolean) => {
    const was = conversations.find((c) => c.id === id)?.archivedAt ?? null;
    setArchivedOv((a) => ({ ...a, [id]: archived ? Date.now() : null }));
    if (archived && id === current) void navigate({ search: (s) => ({ q: s.q, view: s.view }) });
    // Back in the list: show the list it went back to.
    else if (!archived && id === current) void navigate({ search: (s) => ({ ...s, view: undefined }), replace: true });
    archiveChat({ data: { id, archived } })
      .then(() => {
        toast.success(archived ? "Conversation archived." : "Conversation back in the list.", {
          action: archived ? { label: "Undo", onClick: () => archive(id, false) } : undefined,
        });
        void router.invalidate();
      })
      .catch((error: unknown) => {
        setArchivedOv((a) => ({ ...a, [id]: was }));
        toast.error(error instanceof Error ? error.message : "Could not archive.");
      });
  };
  const remove = async (id: string) => {
    try {
      await deleteChat({ data: { id } });
      toast.success("Conversation deleted.");
      if (id === current) await navigate({ search: (s) => ({ q: s.q }), replace: true });
      else await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete.");
      throw error;
    }
  };

  const setQ = (value: string) => void navigate({ search: (s) => ({ ...s, q: value || undefined }), replace: true });
  const sheetOpen = search.list === 1;
  const setSheet = (open: boolean) => void navigate({ search: (s) => ({ ...s, list: open ? 1 : undefined }) });

  const list = (onNavigate?: () => void) => (
    <ConversationList
      conversations={conversations}
      current={current}
      q={q}
      onSearch={setQ}
      onNew={() => {
        onNavigate?.();
        newChat();
      }}
      editing={editing}
      onEditing={(id) => {
        if (id) setEditingHeader(false);
        setEditing(id);
      }}
      onRename={rename}
      onArchive={archive}
      onDelete={remove}
      onNavigate={onNavigate}
      archives={search.view === "archives"}
      onArchives={(open) => void navigate({ search: (s) => ({ ...s, view: open ? "archives" : undefined, q: undefined }), replace: true })}
    />
  );

  const shownThread = thread ? conversations.find((c) => c.id === thread.id) : undefined;
  const archivedNow = shownThread ? Boolean(shownThread.archivedAt) : Boolean(thread?.archivedAt);
  const title = (thread && titles[thread.id]) ?? thread?.title ?? readOnly?.title ?? (current || search.s ? "Conversation" : "New conversation");
  const empty = !current && !search.s && !shownLive && !demo;

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-0 lg:h-dvh" data-testid="chat">
      <h1 className="sr-only">Chat with Hermes</h1>
      <p className="sr-only" aria-live="polite" data-testid="chat-live-status">
        {running ? "Hermes is answering…" : turn && isOver(turn) ? (turn.status === "completed" ? "Answer done." : "Answer stopped.") : ""}
      </p>
      <aside className="hidden w-72 shrink-0 flex-col border-e bg-sidebar/50 lg:flex" aria-label="Your conversations">
        {list()}
      </aside>
      <Sheet open={sheetOpen} onOpenChange={setSheet}>
        <SheetContent side="left" className="w-[min(20rem,88vw)] gap-0 bg-sidebar p-0 pt-10" data-testid="chat-sheet">
          <SheetTitle className="absolute top-3 left-4 text-sm">Conversations</SheetTitle>
          {list(() => setSheet(false))}
        </SheetContent>
      </Sheet>
      <section className="relative flex min-w-0 flex-1 flex-col" aria-label="Conversation">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
          <button type="button" onClick={() => setSheet(true)} className="grid size-9 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden" aria-label="Your conversations" data-testid="chat-open-list">
            <PanelLeft className="size-4" aria-hidden />
          </button>
          {thread && editingHeader ? (
            <div className="min-w-0 flex-1 px-1">
              <TitleInput
                title={title}
                className="max-w-md"
                onDone={(next) => {
                  setEditingHeader(false);
                  if (next) rename(thread.id, next);
                }}
              />
            </div>
          ) : (
            <h2
              className="min-w-0 flex-1 truncate px-1 text-sm font-medium"
              title={thread ? `${title} (double-click to rename)` : title}
              onDoubleClick={() => thread && (setEditing(null), setEditingHeader(true))}
              data-testid="chat-title"
            >
              {title}
              {archivedNow ? <span className="ms-2 rounded-full border px-1.5 py-0.5 align-middle text-2xs font-normal text-muted-foreground">Archived</span> : null}
            </h2>
          )}
          {thread ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger className="grid size-9 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label="Conversation actions">
                <MoreHorizontal className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44" onCloseAutoFocus={(event) => event.preventDefault()}>
                <DropdownMenuItem onSelect={() => (setEditing(null), setEditingHeader(true))}>
                  <Pencil aria-hidden />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => archive(thread.id, !archivedNow)} data-testid="chat-header-archive">
                  {archivedNow ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                  {archivedNow ? "Unarchive" : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => setDeleting(true)}>
                  <Trash2 aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <button type="button" onClick={newChat} className="grid size-9 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring lg:hidden" aria-label="New conversation">
            <SquarePen className="size-4" aria-hidden />
          </button>
        </header>
        {/* Empty, the welcome and the composer sit together in the middle; the spacers keep the composer the same element. */}
        <div className={empty ? "min-h-4 flex-1" : "hidden"} aria-hidden />
        <div className={cn("relative min-h-0", empty ? "flex shrink flex-col" : "flex-1")}>
        <div ref={scrollRef} className={cn("min-h-0 overflow-y-auto overscroll-contain", !empty && "absolute inset-0")} data-testid="chat-scroll">
          <div ref={contentRef} className={cn("mx-auto grid w-full max-w-3xl gap-6 px-4 sm:px-6", empty ? "pt-2 pb-4" : "pt-6 pb-10")}>
            {empty ? <Welcome skills={data.skills} onPick={(text) => setPreset({ text, at: Date.now() })} /> : null}
            {(current && !thread) || (search.s && !current && !readOnly && !data.open) ? (
              <div className="grid justify-items-center gap-2 rounded-xl border border-dashed bg-card/60 px-6 py-12 text-center" role="alert">
                <p className="text-sm font-medium">Could not open this conversation</p>
                <p className="max-w-md text-sm text-muted-foreground">{data.threadError ?? "It does not exist (any more)."}</p>
                <button type="button" onClick={newChat} className="mt-2 text-sm font-medium text-brand-ink underline-offset-2 hover:underline">
                  New conversation
                </button>
              </div>
            ) : null}
            {thread?.partial ? (
              <p className="flex items-center gap-2 text-sm text-warn" role="status">
                History incomplete: Hermes does not answer.
                <button type="button" onClick={() => void router.invalidate()} className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
                  <RefreshCw className="size-3.5" aria-hidden />
                  Try again
                </button>
              </p>
            ) : null}
            {items.map((item, i) =>
              item.role === "user" ? (
                <UserMessage key={item.id} item={item} canEdit={!readOnly && i === lastUser && !running && !unavailable} onEdit={edit} />
              ) : (
                <AssistantTurn key={item.id} at={item.at} parts={item.parts} status={item.status} error={item.error} model={item.model} last={i === items.length - 1 && !shownLive} onRegenerate={!readOnly && !running && !unavailable && lastUser !== -1 ? regenerate : undefined} />
              ),
            )}
            {demo ? (
              <>
                <UserMessage item={{ text: demo.text, images: [] }} />
                <AssistantTurn {...(() => {
                  const t = demoTurn(demo.sse);
                  return { parts: t.parts, status: isOver(t) ? t.status : undefined, error: t.error };
                })()} model="claude-opus-5-5" live={!["failed"].includes(search.demo ?? "")} onApprove={approve} onClarify={clarify} />
              </>
            ) : null}
            {shownLive ? (
              <>
                <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200">
                  <UserMessage item={shownLive.user} />
                </div>
                <AssistantTurn
                  parts={turn?.parts ?? []}
                  status={turn && isOver(turn) && turn.status !== "completed" ? turn.status : turn?.status === "queued" ? "queued" : undefined}
                  error={turn?.error}
                  model={shownLive.model}
                  at={shownLive.user.at}
                  live={!turn || !isOver(turn)}
                  eta={liveEta}
                  last
                  onApprove={approve}
                  onClarify={clarify}
                />
              </>
            ) : null}
          </div>
        </div>
        {!empty ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent" aria-hidden /> : null}
        {!isAtBottom && !empty ? (
          <button
            type="button"
            onClick={() => void scrollToBottom("smooth")}
            className="absolute bottom-3 left-1/2 z-10 grid size-9 -translate-x-1/2 place-items-center rounded-full border bg-background text-muted-foreground shadow-float outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Back to the bottom"
            data-testid="chat-bottom"
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
        ) : null}
        </div>
        <div className="chat-composer-dock mx-auto w-full max-w-3xl shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
          {readOnly ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-sm shadow-panel" role="note" data-testid="chat-readonly">
              <span className="text-muted-foreground">
                {`Read only: this conversation comes from ${sourceName(readOnly.source)}. Hermes goes on with it there.`}
              </span>
              <button type="button" onClick={newChat} className="inline-flex items-center gap-1.5 font-medium text-brand-ink underline-offset-2 hover:underline">
                <SquarePen className="size-4" aria-hidden />
                New conversation
              </button>
            </div>
          ) : (
          <>
          {archivedNow && thread ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/70 px-3 py-2 text-xs text-muted-foreground" role="note" data-testid="chat-archived-note">
              <span className="inline-flex items-center gap-1.5">
                <Archive className="size-3.5" aria-hidden />
                Archived conversation. Writing in it puts it back in the list.
              </span>
              <button type="button" onClick={() => archive(thread.id, false)} className="font-medium text-brand-ink underline-offset-2 hover:underline">
                Unarchive
              </button>
            </div>
          ) : null}
          <Composer
            ref={composer}
            unavailable={unavailable}
            running={running}
            stopping={stopping}
            onSend={(text, images) => send(text, images)}
            onStop={() => void stop()}
            models={data.models}
            choice={choice}
            onChoice={setChoice}
            preset={preset}
            autoFocus={empty}
          />
          </>
          )}
          <p className={cn("mt-1.5 hidden text-center text-2xs text-muted-foreground sm:block")}>Hermes really acts on your server: read what it asks before you accept.</p>
        </div>
        <div className={empty ? "min-h-4 flex-[1.4]" : "hidden"} aria-hidden />
      </section>
      <DeleteDialog open={deleting} title={thread?.title ?? ""} onClose={() => setDeleting(false)} onDelete={() => remove(thread!.id)} />
    </div>
  );
}
