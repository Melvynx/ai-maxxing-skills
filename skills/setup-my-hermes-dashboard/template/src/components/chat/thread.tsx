import { Brain, Check, ChevronRight, CircleAlert, CircleStop, Loader2, Pencil, RotateCcw, ShieldAlert, MessageCircleQuestion, Wrench, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { answerIndex, type ApprovalPart, type ClarifyPart, type Part, type ToolPart, type TurnStatus } from "@/lib/chat/events";
import type { UserItem } from "@/lib/chat/items";
import { cn } from "@/lib/utils";

import type { Eta } from "@/lib/chat/eta";

import { HermesAvatar, messageTime, UserAvatar, useMounted } from "./avatar";
import { EtaPill } from "./eta";
import { ChatMarkdown, CopyButton } from "./markdown";

/** Tool names as the owner reads them. */
const TOOL_NAMES: Record<string, string> = {
  terminal: "Terminal",
  execute_code: "Code",
  read_file: "Read file",
  write_file: "Write file",
  patch: "Edit file",
  search_files: "Search files",
  web_search: "Web search",
  web_extract: "Read web page",
  browser_exec: "Browser",
  skill_view: "Skill",
  skills_list: "Skills list",
  memory: "Memory",
  session_search: "Search history",
  todo: "To-do list",
  delegate_task: "Delegate",
  subagent: "Subagent",
  clarify: "Question",
  vision_analyze: "Look at image",
  image_generate: "Make image",
  cronjob: "Scheduled task",
  send_message: "Send message",
};

export const toolName = (name: string) => TOOL_NAMES[name] ?? name.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const seconds = (s: number | undefined) => (s === undefined ? "" : s < 1 ? "< 1 s" : `${s < 10 ? s.toFixed(1) : Math.round(s)} s`);

function ToolStep({ part }: { part: ToolPart }) {
  const [open, setOpen] = React.useState(false);
  const running = part.status === "running";
  const failed = part.status === "error";
  const detail = Boolean(part.preview || part.result);
  return (
    <li className="min-w-0" data-testid="chat-tool" data-status={part.status}>
      <button
        type="button"
        onClick={() => detail && setOpen((o) => !o)}
        aria-expanded={detail ? open : undefined}
        className={cn("group/step flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", detail && "hover:bg-accent")}
      >
        <span className="grid size-5 shrink-0 place-items-center" aria-hidden>
          {running ? <Loader2 className="size-3.5 animate-spin text-brand" /> : failed ? <X className="size-3.5 text-bad" /> : <Check className="size-3.5 text-good" />}
        </span>
        <span className={cn("shrink-0 font-medium", failed && "text-bad")}>{running ? `Using ${toolName(part.name)}…` : toolName(part.name)}</span>
        {part.preview ? <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{part.preview}</span> : null}
        <span className="ms-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {failed ? <span className="text-bad">Failed</span> : null}
          {seconds(part.duration)}
          {detail ? <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden /> : null}
        </span>
      </button>
      {open ? (
        <div className="mx-2 mt-1 mb-2 grid gap-2 rounded-lg border bg-muted/40 p-3 text-xs">
          {part.preview ? (
            <div className="grid gap-1">
              <span className="font-medium text-muted-foreground">Asked</span>
              <pre className="max-h-40 overflow-auto font-mono whitespace-pre-wrap break-all">{part.preview}</pre>
            </div>
          ) : null}
          {part.result ? (
            <div className="grid gap-1">
              <span className={cn("font-medium", failed ? "text-bad" : "text-muted-foreground")}>{failed ? "Error" : "Result"}</span>
              <pre className="max-h-60 overflow-auto font-mono whitespace-pre-wrap break-all">{part.result}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="min-w-0" data-testid="chat-reasoning">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <Brain className={cn("size-4", live && "animate-pulse text-brand")} aria-hidden />
        <span className="font-medium">{live ? "Thinking…" : "Thinking"}</span>
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      {open ? <p className="mx-2 mt-1 mb-2 border-s-2 ps-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{text}</p> : null}
    </div>
  );
}

const APPROVAL_STATE: Record<ApprovalPart["status"], string> = { pending: "", approved: "Allowed once", denied: "Denied", settled: "Settled", expired: "No longer waiting" };

function ApprovalCard({ part, onAnswer }: { part: ApprovalPart; onAnswer?: (choice: "once" | "deny") => Promise<void> }) {
  const [busy, setBusy] = React.useState<"once" | "deny" | null>(null);
  const pending = part.status === "pending";
  const answer = async (choice: "once" | "deny") => {
    if (!onAnswer) return;
    setBusy(choice);
    try {
      await onAnswer(choice);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className={cn("my-2 grid gap-3 rounded-xl border p-4", pending ? "border-warn-line bg-warn-soft" : "bg-card")} role="group" aria-label="Approval request" data-testid="chat-approval">
      <div className="flex items-start gap-2.5">
        <ShieldAlert className={cn("mt-0.5 size-4 shrink-0", pending ? "text-warn" : "text-muted-foreground")} aria-hidden />
        <div className="grid min-w-0 gap-1">
          <p className="text-sm font-semibold">{pending ? "Hermes asks for your OK" : "Approval request"}</p>
          {part.description ? <p className="text-sm text-muted-foreground">{part.description}</p> : null}
        </div>
      </div>
      {part.command ? <pre className="overflow-x-auto rounded-lg border bg-background px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">{part.command}</pre> : null}
      {pending ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => answer("once")} disabled={busy !== null || !onAnswer} data-testid="chat-approve">
            {busy === "once" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            Allow once
          </Button>
          <Button size="sm" variant="outline" onClick={() => answer("deny")} disabled={busy !== null || !onAnswer} data-testid="chat-deny">
            {busy === "deny" ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
            Deny
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{APPROVAL_STATE[part.status]}</p>
      )}
    </div>
  );
}

function ClarifyCard({ part, onAnswer }: { part: ClarifyPart; onAnswer?: (answer: string) => Promise<void> }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const pending = part.status === "pending";
  const send = async (answer: string) => {
    if (!onAnswer || !answer.trim()) return;
    setBusy(true);
    try {
      await onAnswer(answer.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn("my-2 grid gap-3 rounded-xl border p-4", pending ? "border-brand/40 bg-brand-soft" : "bg-card")} role="group" aria-label="Question from Hermes" data-testid="chat-clarify">
      <div className="flex items-start gap-2.5">
        <MessageCircleQuestion className={cn("mt-0.5 size-4 shrink-0", pending ? "text-brand" : "text-muted-foreground")} aria-hidden />
        <p className="text-sm font-semibold">{part.question || "Hermes has a question"}</p>
      </div>
      {pending ? (
        <>
          {part.choices.length ? (
            <div className="flex flex-wrap gap-2">
              {part.choices.map((choice) => (
                <Button key={choice} size="sm" variant="outline" disabled={busy || !onAnswer} onClick={() => send(choice)}>
                  {choice}
                </Button>
              ))}
            </div>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send(text);
            }}
          >
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Your answer"
              aria-label="Your answer"
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <Button size="sm" type="submit" disabled={busy || !text.trim() || !onAnswer} className="h-9">
              Answer
            </Button>
          </form>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{part.status === "expired" ? "No longer waiting" : "Answered"}</p>
      )}
    </div>
  );
}

/** One line while nothing has arrived yet. */
export function Thinking({ label = "Hermes is thinking…" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground" role="status" data-testid="chat-thinking">
      <span className="flex gap-1" aria-hidden>
        <span className="size-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-brand [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-brand" />
      </span>
      <span className="chat-shimmer">{label}</span>
    </p>
  );
}

const END: Partial<Record<TurnStatus, { tone: "bad" | "muted" | "warn"; text: string }>> = {
  failed: { tone: "bad", text: "The answer failed." },
  cancelled: { tone: "muted", text: "Answer stopped." },
  interrupted: { tone: "warn", text: "Answer interrupted." },
};

function EndLine({ status, error }: { status: TurnStatus; error?: string }) {
  const end = END[status];
  if (!end) return null;
  const detail = error && error !== "interrupted_by_user" ? error : null;
  return (
    <div className={cn("mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-sm", end.tone === "bad" ? "bg-bad-soft text-bad" : end.tone === "warn" ? "bg-warn-soft text-warn" : "text-muted-foreground")} role={end.tone === "muted" ? undefined : "alert"} data-testid="chat-end" data-status={status}>
      {status === "cancelled" ? <CircleStop className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span>
        {end.text}
        {detail ? <span className="block text-xs opacity-80">{detail}</span> : null}
      </span>
    </div>
  );
}

/** Steps done before the answer: open while Hermes works, folded into one line once the answer is there. */
function Steps({ parts, live, answered, onApprove, onClarify }: { parts: Part[]; live: boolean; answered: boolean; onApprove?: (part: ApprovalPart, choice: "once" | "deny") => Promise<void>; onClarify?: (part: ClarifyPart, answer: string) => Promise<void> }) {
  const tools = parts.filter((p): p is ToolPart => p.kind === "tool");
  const pendingCard = parts.some((p) => (p.kind === "approval" || p.kind === "clarify") && p.status === "pending");
  const [open, setOpen] = React.useState(false);
  const folded = answered && !live && !pendingCard && tools.length > 0 && !open;
  if (folded) {
    const failed = tools.filter((t) => t.status === "error").length;
    const total = tools.reduce((s, t) => s + (t.duration ?? 0), 0);
    return (
      <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className="mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" data-testid="chat-steps-folded">
        <Wrench className="size-3.5" aria-hidden />
        <span>
          {tools.length === 1 ? `Used ${toolName(tools[0]!.name)}` : `${tools.length} steps`}
          {failed ? <span className="text-bad"> · {failed} failed</span> : null}
          {total >= 1 ? ` · ${seconds(total)}` : ""}
        </span>
        <ChevronRight className="size-3.5" aria-hidden />
      </button>
    );
  }
  return (
    <div className="mb-1 grid gap-0.5" data-testid="chat-steps">
      {answered && open ? (
        <button type="button" onClick={() => setOpen(false)} aria-expanded className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-3.5 rotate-90" aria-hidden />
          Fold the steps
        </button>
      ) : null}
      {parts.map((part, i) => {
        if (part.kind === "tool")
          return (
            <ul key={i} className="contents">
              <ToolStep part={part} />
            </ul>
          );
        if (part.kind === "reasoning") return <Reasoning key={i} text={part.text} live={live && i === parts.length - 1} />;
        if (part.kind === "approval") return <ApprovalCard key={i} part={part} onAnswer={onApprove ? (choice) => onApprove(part, choice) : undefined} />;
        if (part.kind === "clarify") return <ClarifyCard key={i} part={part} onAnswer={onClarify ? (answer) => onClarify(part, answer) : undefined} />;
        // A comment on the way, never mixed with the answer.
        return (
          <p key={i} className="px-2 py-1 text-sm leading-relaxed text-muted-foreground" data-testid="chat-commentary">
            {part.text}
          </p>
        );
      })}
    </div>
  );
}

/** « Hermes · 14:32 » / « You · yesterday 09:10 » above a message (the time only in the browser: it follows the viewer's zone). */
function Byline({ name, at, end }: { name: string; at?: number | null; end?: boolean }) {
  const mounted = useMounted();
  return (
    <div className={cn("flex h-5 items-center gap-1.5 text-xs text-muted-foreground", end && "justify-end")} data-testid="chat-byline">
      <span className="font-medium text-foreground/85">{name}</span>
      {mounted && at ? (
        <time dateTime={new Date(at).toISOString()} className="tabular-nums">
          {messageTime(at)}
        </time>
      ) : null}
    </div>
  );
}

export type AssistantProps = {
  at?: number | null;
  parts: Part[];
  status?: TurnStatus;
  error?: string;
  model: string | null;
  live?: boolean;
  /** The live run's wait estimate (« ⏱️ ~2 min left »), shown until it ends. */
  eta?: Eta | null;
  last?: boolean;
  onRegenerate?: () => void;
  onApprove?: (part: ApprovalPart, choice: "once" | "deny") => Promise<void>;
  onClarify?: (part: ClarifyPart, answer: string) => Promise<void>;
};

export function AssistantTurn({ at, parts, status, error, model, live = false, eta, last = false, onRegenerate, onApprove, onClarify }: AssistantProps) {
  const answerAt = answerIndex(parts);
  // While Hermes works, the last text may still turn into a comment before a tool: it is the answer only if nothing follows.
  const answer = answerAt === -1 ? null : (parts[answerAt] as { kind: "text"; text: string });
  const steps = answerAt === -1 ? parts : parts.slice(0, answerAt);
  const waiting = live && !answer && !steps.some((p) => p.kind === "tool" && p.status === "running") && !steps.some((p) => (p.kind === "approval" || p.kind === "clarify") && p.status === "pending");
  return (
    <article className="group/turn grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2.5 sm:gap-x-3" aria-label="Answer from Hermes" data-testid="chat-assistant">
      <HermesAvatar className="mt-0.5" />
      <div className="min-w-0">
      <Byline name="Hermes" at={at} />
      {steps.length ? <Steps parts={steps} live={live} answered={Boolean(answer)} onApprove={onApprove} onClarify={onClarify} /> : null}
      {answer ? <ChatMarkdown text={answer.text} streaming={live} /> : null}
      {waiting ? <Thinking label={status === "queued" ? "In the queue…" : steps.length ? "Hermes keeps going…" : "Hermes is thinking…"} /> : null}
      {live && eta ? <EtaPill eta={eta} /> : null}
      {status ? <EndLine status={status} error={error} /> : null}
      {!live ? (
        <div className={cn("mt-1.5 flex h-7 items-center gap-1 text-xs text-muted-foreground transition-opacity", last ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover/turn:opacity-100 sm:group-focus-within/turn:opacity-100")}>
          {answer ? <CopyButton text={answer.text} label="Copy the answer" className="size-7 justify-center" /> : null}
          {last && onRegenerate ? (
            <button type="button" onClick={onRegenerate} className="inline-flex size-7 items-center justify-center rounded-md outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label="Regenerate the answer" title="Regenerate" data-testid="chat-regenerate">
              <RotateCcw className="size-3.5" aria-hidden />
            </button>
          ) : null}
          {model ? (
            <span className="ms-1 truncate" data-testid="chat-model">
              {model}
            </span>
          ) : null}
        </div>
      ) : null}
      </div>
    </article>
  );
}

export function UserMessage({ item, canEdit, onEdit }: { item: Pick<UserItem, "text" | "images"> & { at?: number | null }; canEdit?: boolean; onEdit?: (text: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.text);
  if (editing && onEdit)
    return (
      <form
        className="ms-auto grid w-full max-w-[85%] gap-2 rounded-2xl border bg-card p-3 shadow-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          setEditing(false);
          onEdit(draft.trim());
        }}
        data-testid="chat-edit"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          rows={Math.min(10, Math.max(2, draft.split("\n").length))}
          aria-label="Edit the message"
          autoFocus
          className="w-full resize-none bg-transparent text-[0.9375rem] leading-7 outline-none"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!draft.trim()}>
            Send
          </Button>
        </div>
      </form>
    );
  return (
    <div className="group/user flex min-w-0 justify-end gap-2.5 sm:gap-3" data-testid="chat-user">
    <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1">
      <Byline name="You" at={item.at} end />
      {item.images.length ? (
        <div className="flex flex-wrap justify-end gap-2">
          {item.images.map((src, i) =>
            src ? (
              <img key={i} src={src} alt={`Image ${i + 1} sent`} className="size-28 rounded-xl border object-cover sm:size-36" />
            ) : (
              <span key={i} className="grid size-28 place-items-center rounded-xl border bg-muted text-xs text-muted-foreground">
                Image
              </span>
            ),
          )}
        </div>
      ) : null}
      {item.text ? <div className="max-w-full rounded-2xl rounded-tr-md bg-secondary px-4 py-2.5 text-[0.9375rem] leading-[1.65] whitespace-pre-wrap break-words text-secondary-foreground">{item.text}</div> : null}
      <div className="flex h-7 items-center gap-1 text-muted-foreground opacity-100 transition-opacity sm:opacity-0 sm:group-hover/user:opacity-100 sm:group-focus-within/user:opacity-100">
        {item.text ? <CopyButton text={item.text} label="Copy the message" className="size-7 justify-center" /> : null}
        {canEdit && onEdit ? (
          <button
            type="button"
            onClick={() => {
              setDraft(item.text);
              setEditing(true);
            }}
            className="inline-flex size-7 items-center justify-center rounded-md outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Edit and send again"
            title="Edit and send again"
            data-testid="chat-edit-button"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
      <UserAvatar className="mt-0.5" />
    </div>
  );
}
