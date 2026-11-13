import { User } from "lucide-react";
import * as React from "react";

import { SectionMark } from "@/components/brand";
import { cn } from "@/lib/utils";

/** The person writing: a round mark on a soft tint, next to their messages. */
export function UserAvatar({ className }: { className?: string }) {
  return (
    <span className={cn("grid size-7 shrink-0 select-none place-items-center rounded-full bg-secondary text-secondary-foreground", className)} aria-hidden data-testid="chat-avatar">
      <User className="size-3.5" />
    </span>
  );
}

/** Hermes's own mark, round like the person's. */
export function HermesAvatar({ className }: { className?: string }) {
  return <SectionMark section="hermes" className={cn("size-7 shrink-0 rounded-full", className)} />;
}

/** « 14:32 » today, « yesterday 09:10 », else « Nov 3 14:32 ». Built once (never per message). */
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" });
export function messageTime(at: number, now = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const time = TIME.format(at);
  if (at >= start.getTime()) return time;
  if (at >= start.getTime() - 86_400_000) return `yesterday ${time}`;
  return `${DAY.format(at)} ${time}`;
}

/** True once in the browser: times depend on the viewer's clock and zone, so the server never writes them. */
export function useMounted() {
  return React.useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}
