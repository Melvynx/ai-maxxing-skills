import { useRouter, useRouterState } from "@tanstack/react-router";
import * as React from "react";
import { toast } from "sonner";

import type { ChatUnread } from "@/lib/chat/items";
import { getChatPulse } from "@/server/chat-fns";

import { CHAT_PULSE_EVENT, ChatPulseContext, endLabel, newAnswers } from "./pulse-context";

/**
 * Admins' layout: Hermes answers that ended while the person was elsewhere. Polled every 15 s (and when the tab comes
 * back); each new one rings a ding, shows a toast « Hermes is done » with « Open », a system notification when the
 * tab is in the background (permission asked on the first message sent), and « (n) » in the tab title. The answer
 * on screen (its conversation open, tab visible) is not news. The first visit of a browser only remembers the backlog.
 */

const POLL_MS = 15_000;
const SEEN_KEY = "dashboard-chat-answers-seen";

/** A soft two-note ding, made in the browser (no sound file). Silent when the browser blocks audio. */
function playDing() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [880, 1320];
    notes.forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = ctx.currentTime + i * 0.12;
      osc.type = "sine";
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.4);
    });
    setTimeout(() => void ctx.close().catch(() => null), 1000);
  } catch {
    /* no audio: the toast and the title remain */
  }
}

function readSeen(): string[] | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const writeSeen = (keys: string[]) => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(keys));
  } catch {
    /* private mode */
  }
};

/** The tab title with « (n) » in front while answers wait (the router rewrites the title on navigation: applied again). */
function applyTitle(count: number) {
  const bare = document.title.replace(/^\(\d+\+?\) /, "");
  const next = count > 0 ? `(${count > 9 ? "9+" : count}) ${bare}` : bare;
  if (document.title !== next) document.title = next;
}

function systemNotify(item: ChatUnread, open: () => void) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const n = new Notification(endLabel(item.status), { body: item.title, tag: `dashboard-chat-${item.id}`, icon: "/favicon.ico" });
    n.onclick = () => {
      window.focus();
      open();
      n.close();
    };
  } catch {
    /* some browsers (iOS outside an installed app) have no notifications: the toast and the title remain */
  }
}

export function ChatPulseProvider({ admin, children }: { admin: boolean; children: React.ReactNode }) {
  const [unread, setUnread] = React.useState<ChatUnread[]>([]);
  const router = useRouter();
  const location = useRouterState({ select: (s) => s.location });
  const where = React.useRef(location);
  where.current = location;

  const check = React.useCallback(async () => {
    const list = await getChatPulse().catch(() => null);
    if (!list) return;
    // The conversation on screen is being read: the Chat page marks it seen, it is not news.
    const loc = where.current;
    const onScreen = document.visibilityState === "visible" && loc.pathname === "/chat" ? ((loc.search as { c?: string }).c ?? null) : null;
    const shown = list.filter((u) => u.id !== onScreen);
    setUnread(shown);
    const { fresh, seen } = newAnswers(list, readSeen());
    writeSeen(seen);
    const ring = fresh.filter((u) => u.id !== onScreen);
    if (!ring.length) return;
    playDing();
    for (const item of ring.slice(0, 3)) {
      const open = () => void router.navigate({ to: "/chat", search: { c: item.id } });
      toast.success(endLabel(item.status), { description: item.title, position: "top-right", duration: 10_000, action: { label: "Open", onClick: open } });
      if (document.visibilityState !== "visible") systemNotify(item, open);
    }
  }, [router]);

  React.useEffect(() => {
    if (!admin) return;
    void check();
    const id = setInterval(() => void check(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void check();
    const onAsk = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(CHAT_PULSE_EVENT, onAsk);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(CHAT_PULSE_EVENT, onAsk);
    };
  }, [admin, check]);

  // The count in the tab title, put back after each navigation (the router writes the page title).
  React.useEffect(() => {
    if (!admin) return;
    applyTitle(unread.length);
    const t = setTimeout(() => applyTitle(unread.length), 300);
    return () => clearTimeout(t);
  }, [admin, unread.length, location.href]);

  const value = React.useMemo(() => ({ unread: admin ? unread : [], refresh: () => void check() }), [admin, unread, check]);
  return <ChatPulseContext.Provider value={value}>{children}</ChatPulseContext.Provider>;
}
