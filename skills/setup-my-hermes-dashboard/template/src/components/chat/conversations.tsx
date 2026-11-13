import { Link } from "@tanstack/react-router";
import { Archive, ArchiveRestore, ArrowLeft, Loader2, MoreHorizontal, Pencil, Search, SquarePen, Trash2 } from "lucide-react";
import * as React from "react";

import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ChatSummary } from "@/lib/chat/items";
import { cn } from "@/lib/utils";

import { ListEta } from "./eta";

const DAY = 86_400_000;

/** « Today », « Yesterday », « Last 7 days », « Last 30 days », then by month. */
export function groupByDate(list: ChatSummary[], now: number): { label: string; items: ChatSummary[] }[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const label = (at: number) => {
    if (at >= today) return "Today";
    if (at >= today - DAY) return "Yesterday";
    if (at >= today - 7 * DAY) return "Last 7 days";
    if (at >= today - 30 * DAY) return "Last 30 days";
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(at);
  };
  const groups: { label: string; items: ChatSummary[] }[] = [];
  for (const item of list) {
    const name = label(item.updatedAt);
    const last = groups[groups.length - 1];
    if (last?.label === name) last.items.push(item);
    else groups.push({ label: name, items: [item] });
  }
  return groups;
}

export const matches = (item: ChatSummary, q: string) => !q.trim() || item.title.toLowerCase().includes(q.trim().toLowerCase());

/**
 * A title edited in place (the list row or the conversation's header): selected at once, Enter or a click elsewhere
 * keeps it, Escape gives up. The new title shows straight away; the server follows.
 */
export function TitleInput({ title, onDone, className }: { title: string; onDone: (title: string | null) => void; className?: string }) {
  const [value, setValue] = React.useState(title);
  const done = React.useRef(false);
  // A menu that just closed may take the focus back for a moment: that is not the person leaving the field.
  const born = React.useRef(0);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    const clean = next?.replace(/\s+/g, " ").trim() ?? "";
    onDone(clean && clean !== title ? clean.slice(0, 120) : null);
  };
  return (
    <input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          finish(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        }
      }}
      onBlur={(event) => {
        const el = event.currentTarget;
        if (performance.now() - born.current < 400) return void requestAnimationFrame(() => (el.focus(), el.select()));
        finish(value);
      }}
      ref={(el) => {
        if (el && !el.dataset.ready) {
          el.dataset.ready = "1";
          born.current = performance.now();
          requestAnimationFrame(() => (el.focus(), el.select()));
        }
      }}
      maxLength={120}
      aria-label="New title"
      className={cn("h-8 w-full min-w-0 rounded-md border border-ring/60 bg-background px-2 text-sm outline-none ring-[3px] ring-ring/20", className)}
      data-testid="chat-rename-input"
    />
  );
}

export function DeleteDialog({ open, title, onClose, onDelete }: { open: boolean; title: string; onClose: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogTitle>Delete the conversation?</AlertDialogTitle>
        <AlertDialogDescription>
          “{title}” and its messages will be deleted, here and in Hermes. What Hermes saved in its memory stays.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogConfirm
            destructive
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
            data-testid="chat-delete-confirm"
          >
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Delete
          </AlertDialogConfirm>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export type ListProps = {
  conversations: ChatSummary[];
  current: string | null;
  q: string;
  onSearch: (q: string) => void;
  onNew: () => void;
  /** The row whose title is being edited in place (the header's « Rename » uses the same). */
  editing: string | null;
  onEditing: (id: string | null) => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string) => Promise<void>;
  onNavigate?: () => void;
  /** The archived conversations instead of the others. */
  archives: boolean;
  onArchives: (open: boolean) => void;
};

export function ConversationList({ conversations, current, q, onSearch, onNew, editing, onEditing, onRename, onArchive, onDelete, onNavigate, archives, onArchives }: ListProps) {
  const [deleting, setDeleting] = React.useState<ChatSummary | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => setNow(Date.now()), [conversations]);
  const archived = conversations.filter((c) => c.archivedAt);
  const inView = archives ? archived : conversations.filter((c) => !c.archivedAt);
  const shown = inView.filter((c) => matches(c, q));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="chat-list">
      <div className="grid gap-2 px-3 pt-3">
        {archives ? (
          <button
            type="button"
            onClick={() => onArchives(false)}
            className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="chat-archives-back"
          >
            <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
            Archives
            <span className="ms-auto text-xs font-normal text-muted-foreground tabular-nums">{archived.length}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onNew}
            className="flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-panel outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="chat-new"
          >
            <SquarePen className="size-4 text-brand" aria-hidden />
            New conversation
            <kbd className="ms-auto hidden font-sans text-2xs text-muted-foreground lg:inline">Ctrl K</kbd>
          </button>
        )}
        <label className="relative">
          <span className="sr-only">{archives ? "Search the archives" : "Search a conversation"}</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={archives ? "Search the archives" : "Search"}
            className="h-9 w-full rounded-lg border bg-background ps-8 pe-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-testid="chat-search"
          />
        </label>
      </div>
      <nav aria-label={archives ? "Archived conversations" : "Conversations"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {shown.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {inView.length ? "No title matches." : archives ? "No archived conversation." : "No conversation yet."}
          </p>
        ) : (
          groupByDate(shown, now).map((group) => (
            <div key={group.label} className="grid gap-0.5 pt-3 first:pt-1">
              <span className="px-2 pb-1 text-2xs font-semibold tracking-[0.06em] text-muted-foreground/80 uppercase">{group.label}</span>
              {group.items.map((item) => {
                const active = item.id === current;
                if (editing === item.id)
                  return (
                    <div key={item.id} className="px-0.5 py-0.5" data-testid="chat-list-item">
                      <TitleInput
                        title={item.title}
                        onDone={(title) => {
                          onEditing(null);
                          if (title) onRename(item.id, title);
                        }}
                      />
                    </div>
                  );
                return (
                  <div key={item.id} className={cn("group/conv relative flex min-w-0 items-center rounded-lg transition-colors duration-150", active ? "bg-card shadow-panel ring-1 ring-border" : "hover:bg-accent")} data-testid="chat-list-item">
                    <Link
                      to="/chat"
                      search={(s: Record<string, unknown>) => ({ ...s, c: item.id, s: undefined, list: undefined })}
                      onClick={onNavigate}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        onEditing(item.id);
                      }}
                      aria-current={active ? "page" : undefined}
                      className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg ps-2.5 pe-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-9"
                    >
                      {item.running ? (
                        <span className="size-2 shrink-0 animate-pulse rounded-full bg-brand" role="img" aria-label="Answer in progress" />
                      ) : item.unread && !active ? (
                        <span className="size-2 shrink-0 rounded-full bg-brand ring-2 ring-brand/25" role="img" aria-label="Answer done, not read yet" data-testid="chat-unread-dot" />
                      ) : null}
                      <span className={cn("truncate", active || (item.unread && !item.running) ? "font-medium text-foreground" : "text-foreground/85")} title={item.title}>
                        {item.title}
                      </span>
                      {item.running && item.eta ? <ListEta eta={item.eta} /> : null}
                    </Link>
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger
                        className={cn("absolute end-1 grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:opacity-100", active ? "opacity-100" : "opacity-100 lg:opacity-0 lg:group-hover/conv:opacity-100 lg:focus-visible:opacity-100")}
                        aria-label={`Actions for “${item.title}”`}
                        data-testid="chat-item-menu"
                      >
                        <MoreHorizontal className="size-4" aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44" onCloseAutoFocus={(event) => event.preventDefault()}>
                        <DropdownMenuItem onSelect={() => onEditing(item.id)} data-testid="chat-rename">
                          <Pencil aria-hidden />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onArchive(item.id, !item.archivedAt)} data-testid="chat-archive">
                          {item.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                          {item.archivedAt ? "Unarchive" : "Archive"}
                        </DropdownMenuItem>
                        <DropdownMenuItem destructive onSelect={() => setDeleting(item)} data-testid="chat-delete">
                          <Trash2 aria-hidden />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </nav>
      <div className="grid gap-0.5 border-t px-2 py-2">
        {!archives ? (
          <button
            type="button"
            onClick={() => onArchives(true)}
            className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="chat-archives"
          >
            <Archive className="size-4" aria-hidden />
            Archives
            {archived.length ? <span className="ms-auto text-xs tabular-nums">{archived.length}</span> : null}
          </button>
        ) : null}
      </div>
      <DeleteDialog open={deleting !== null} title={deleting?.title ?? ""} onClose={() => setDeleting(null)} onDelete={() => onDelete(deleting!.id)} />
    </div>
  );
}
