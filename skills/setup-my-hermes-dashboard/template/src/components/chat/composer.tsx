import { ArrowUp, Brain, Check, ChevronDown, FileText, Loader2, Paperclip, Square, TriangleAlert, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { AlertDialog, AlertDialogCancel, AlertDialogConfirm, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { REASONING, REASONING_LABELS, type ChatModel, type ModelChoice, type Reasoning } from "@/lib/chat/items";
import { cn } from "@/lib/utils";

import { imageFiles, ImageError, MAX_IMAGES, prepareImage, type Attachment } from "./images";

/** Files other than images (CSV, Excel, PDF…): uploaded at once, then named in the message for Hermes. */
const MAX_FILES = 10;
const FILE_ACCEPT = ".csv,.tsv,.txt,.md,.json,.xlsx,.xls,.ods,.pdf,.docx,.doc,.pptx,.zip,.xml,.html";
type JoinedFile = { id: string; name: string; size: number; path: string | null };

const base64Of = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

async function uploadFile(file: File): Promise<{ path: string; name: string; size: number }> {
  if (file.size > 15_000_000) throw new Error(`"${file.name}" is over 15 MB.`);
  const response = await fetch("/api/hermes-chat/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file.name, data: await base64Of(file) }) });
  const body = (await response.json().catch(() => null)) as { path?: string; name?: string; size?: number; message?: string; error?: { message?: string } } | null;
  if (!response.ok || !body?.path) throw new Error(body?.error?.message ?? body?.message ?? `Could not send "${file.name}".`);
  return { path: body.path, name: body.name ?? file.name, size: body.size ?? file.size };
}

const sizeLabel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export type ModelsInfo = { current: { provider: string; model: string } | null; models: ChatModel[] } | null;

/** The model picker of the composer: Hermes's main model by default, every connected provider's models, the reasoning level. */
export function ModelPicker({ models, choice, onChange, disabled }: { models: ModelsInfo; choice: ModelChoice | null; onChange: (choice: ModelChoice | null) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [confirm, setConfirm] = React.useState<ChatModel | null>(null);
  const list = models?.models ?? [];
  const main = models?.current ?? null;
  const selected = choice ? list.find((m) => m.provider === choice.provider && m.model === choice.model) : null;
  const shownModel = choice?.model ?? main?.model ?? "Main model";
  const takesReasoning = choice ? Boolean(selected?.reasoning) : Boolean(main && list.find((m) => m.provider === main.provider && m.model === main.model)?.reasoning);
  const reasoning: Reasoning = choice?.reasoning ?? "default";
  const groups = React.useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const map = new Map<string, ChatModel[]>();
    for (const m of list) if (!needle || m.model.toLowerCase().includes(needle) || m.providerName.toLowerCase().includes(needle)) map.set(m.providerName, [...(map.get(m.providerName) ?? []), m]);
    return [...map.entries()];
  }, [list, filter]);

  const pick = (m: ChatModel | null) => {
    if (m?.expensive) {
      setConfirm(m);
      return;
    }
    onChange(m ? { provider: m.provider, model: m.model, reasoning: m.reasoning ? reasoning : "default" } : null);
    setOpen(false);
  };
  const setReasoning = (level: Reasoning) => {
    if (choice) onChange({ ...choice, reasoning: level });
    else if (main) onChange({ provider: main.provider, model: main.model, reasoning: level });
  };
  const row = "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent lg:py-1.5";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled || !models}
            className="inline-flex h-8 max-w-[11rem] min-w-0 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:max-w-[16rem]"
            aria-label={`Model: ${shownModel}${reasoning !== "default" ? `, thinking ${REASONING_LABELS[reasoning].toLowerCase()}` : ""}`}
            data-testid="chat-model-picker"
          >
            <span className="truncate">{shownModel}</span>
            {reasoning !== "default" ? <Brain className="size-3.5 shrink-0 text-brand" aria-hidden /> : null}
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="grid w-80 gap-2 p-2" data-testid="chat-model-menu">
          {list.length > 8 ? (
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search a model"
              aria-label="Search a model"
              className="h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          ) : null}
          <div className="grid max-h-[min(22rem,50dvh)] gap-0.5 overflow-y-auto overscroll-contain" role="listbox" aria-label="Models">
            <button type="button" role="option" aria-selected={!choice} className={row} onClick={() => pick(null)}>
              <span className="grid min-w-0 flex-1">
                <span className="font-medium">Hermes's main model</span>
                <span className="truncate text-xs text-muted-foreground">{main?.model ?? "the one in its config"}</span>
              </span>
              {!choice ? <Check className="size-4 shrink-0 text-brand" aria-hidden /> : null}
            </button>
            {groups.map(([provider, items]) => (
              <div key={provider} className="grid gap-0.5" role="group" aria-label={provider}>
                <span className="px-2 pt-2 pb-0.5 text-2xs font-semibold tracking-[0.06em] text-muted-foreground/80 uppercase">{provider}</span>
                {items.map((m) => {
                  const active = choice?.provider === m.provider && choice.model === m.model;
                  return (
                    <button key={`${m.provider}:${m.model}`} type="button" role="option" aria-selected={active} className={row} onClick={() => pick(m)}>
                      <span className="min-w-0 flex-1 truncate">{m.model}</span>
                      {m.expensive ? <TriangleAlert className="size-3.5 shrink-0 text-warn" aria-label="Expensive model" /> : null}
                      {m.model === main?.model && m.provider === main?.provider ? <span className="shrink-0 text-2xs text-muted-foreground">main</span> : null}
                      {active ? <Check className="size-4 shrink-0 text-brand" aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
            {!groups.length ? <p className="px-2 py-3 text-sm text-muted-foreground">No model found.</p> : null}
          </div>
          {takesReasoning ? (
            <div className="grid gap-1.5 border-t px-1 pt-2" data-testid="chat-reasoning-level">
              <span className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                <Brain className="size-3.5" aria-hidden />
                Thinking
              </span>
              <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label="Thinking level">
                {REASONING.map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={reasoning === level}
                    onClick={() => setReasoning(level)}
                    className={cn("h-8 rounded-md px-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", reasoning === level ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}
                  >
                    {REASONING_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Expensive model</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.expensive}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogConfirm
              onClick={() => {
                if (confirm) onChange({ provider: confirm.provider, model: confirm.model, reasoning: confirm.reasoning ? reasoning : "default" });
                setConfirm(null);
                setOpen(false);
              }}
            >
              Use {confirm?.model}
            </AlertDialogConfirm>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export type ComposerProps = {
  /** Hermes cannot take a message (stopped, chat off): the reason, shown in place of the hint. */
  unavailable: string | null;
  running: boolean;
  stopping: boolean;
  onSend: (text: string, images: Attachment[]) => Promise<boolean>;
  onStop: () => void;
  models: ModelsInfo;
  choice: ModelChoice | null;
  onChoice: (choice: ModelChoice | null) => void;
  /** Text put in by a suggestion of the empty screen. */
  preset?: { text: string; at: number } | null;
  autoFocus?: boolean;
};

export const Composer = React.forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer({ unavailable, running, stopping, onSend, onStop, models, choice, onChoice, preset, autoFocus }, ref) {
  const [text, setText] = React.useState("");
  const [images, setImages] = React.useState<Attachment[]>([]);
  const [files, setFiles] = React.useState<JoinedFile[]>([]);
  const [adding, setAdding] = React.useState(0);
  const [sending, setSending] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const area = React.useRef<HTMLTextAreaElement | null>(null);
  const file = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(ref, () => area.current!, []);

  // Grows with the text up to 40 % of the screen, then scrolls.
  React.useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4))}px`;
  }, [text]);

  React.useEffect(() => {
    if (!preset) return;
    setText(preset.text);
    area.current?.focus();
  }, [preset]);

  const addFiles = async (list: File[]) => {
    const room = MAX_FILES - files.length;
    if (room <= 0) return void toast.error(`No more than ${MAX_FILES} files per message.`);
    for (const f of list.slice(0, room)) {
      const id = crypto.randomUUID();
      setFiles((now) => [...now, { id, name: f.name, size: f.size, path: null }]);
      try {
        const saved = await uploadFile(f);
        setFiles((now) => now.map((x) => (x.id === id ? { ...x, ...saved } : x)));
      } catch (error) {
        setFiles((now) => now.filter((x) => x.id !== id));
        toast.error(error instanceof Error ? error.message : "Could not read the file.");
      }
    }
  };

  /** Pasted, dropped or picked files: images go to the model, the others are uploaded for Hermes. */
  const addAny = (list: File[]) => {
    const pictures = imageFiles(list as unknown as FileList);
    const others = list.filter((f) => !f.type.startsWith("image/"));
    if (pictures.length) void add(pictures);
    if (others.length) void addFiles(others);
  };

  const add = async (files: File[]) => {
    const room = MAX_IMAGES - images.length;
    if (!files.length) return;
    if (room <= 0) return void toast.error(`No more than ${MAX_IMAGES} images per message.`);
    if (files.length > room) toast.error(`Only ${room} more image${room > 1 ? "s" : ""} kept (${MAX_IMAGES} at most).`);
    setAdding((n) => n + Math.min(room, files.length));
    for (const f of files.slice(0, room)) {
      try {
        const image = await prepareImage(f);
        setImages((list) => (list.length < MAX_IMAGES ? [...list, image] : list));
      } catch (error) {
        toast.error(error instanceof ImageError ? error.message : "Could not read the image.");
      } finally {
        setAdding((n) => n - 1);
      }
    }
  };

  const blocked = unavailable !== null;
  const uploading = files.some((f) => f.path === null);
  const canSend = !blocked && !running && !sending && adding === 0 && !uploading && (text.trim().length > 0 || images.length > 0 || files.length > 0);
  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    // The message leaves the box at once (it shows in the thread at the same moment); a refusal puts it back.
    const draft = { text, images, files };
    setText("");
    setImages([]);
    setFiles([]);
    const lines = draft.files.map((f) => `📎 Attached file: ${f.name} → ${f.path}`).join("\n");
    const sent = await onSend([draft.text.trim(), lines].filter(Boolean).join("\n\n"), draft.images);
    setSending(false);
    if (!sent) {
      setText((now) => (now ? now : draft.text));
      setImages((now) => (now.length ? now : draft.images));
      setFiles((now) => (now.length ? now : draft.files));
    }
  };

  return (
    <form
      className={cn("relative grid gap-2 rounded-2xl border bg-card p-2 shadow-panel transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:shadow-float", dragging && "border-brand ring-2 ring-brand/30", blocked && "opacity-80")}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onDragOver={(event) => {
        if (blocked || !Array.from(event.dataTransfer.items).some((i) => i.kind === "file")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        setDragging(false);
        const dropped = Array.from(event.dataTransfer.files);
        if (!dropped.length || blocked) return;
        event.preventDefault();
        addAny(dropped);
      }}
      data-testid="chat-composer"
    >
      {images.length || adding ? (
        <ul className="flex flex-wrap gap-2 px-1 pt-1" aria-label="Attached images">
          {images.map((image) => (
            <li key={image.id} className="relative">
              <img src={image.thumb} alt={image.name} className="size-16 rounded-lg border object-cover" />
              <button
                type="button"
                onClick={() => setImages((list) => list.filter((i) => i.id !== image.id))}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-panel hover:text-foreground"
                aria-label={`Remove ${image.name}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
          {Array.from({ length: adding }, (_, i) => (
            <li key={`adding-${i}`} className="grid size-16 place-items-center rounded-lg border bg-muted">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Preparing the image" />
            </li>
          ))}
        </ul>
      ) : null}
      {files.length ? (
        <ul className="flex flex-wrap gap-2 px-1 pt-1" aria-label="Attached files" data-testid="chat-files">
          {files.map((f) => (
            <li key={f.id} className="flex max-w-64 items-center gap-2 rounded-lg border bg-muted/50 py-1.5 ps-2 pe-1 text-sm">
              {f.path ? <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Sending the file" />}
              <span className="min-w-0 truncate" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{sizeLabel(f.size)}</span>
              <button
                type="button"
                onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
                className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${f.name}`}
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        ref={area}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
        onPaste={(event) => {
          const pasted = Array.from(event.clipboardData.files);
          if (!pasted.length || blocked) return;
          event.preventDefault();
          addAny(pasted);
        }}
        rows={1}
        disabled={blocked}
        autoFocus={autoFocus}
        placeholder={blocked ? "Hermes cannot be reached right now" : "Write to Hermes…"}
        aria-label="Message to Hermes"
        className="max-h-[40dvh] min-h-11 w-full resize-none bg-transparent px-2 py-2 text-[0.9375rem] leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        data-testid="chat-input"
      />
      <div className="flex items-center gap-1">
        <input ref={file} type="file" accept={`image/png,image/jpeg,image/webp,image/gif,${FILE_ACCEPT}`} multiple hidden onChange={(event) => (addAny(Array.from(event.target.files ?? [])), (event.target.value = ""))} />
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={blocked}
          className="grid size-8 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          aria-label="Attach a file"
          title="Attach an image or a file (CSV, Excel, PDF…), or drop it here"
        >
          <Paperclip className="size-4" aria-hidden />
        </button>
        <ModelPicker models={models} choice={choice} onChange={onChoice} disabled={blocked} />
        <span className="ms-auto" />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            className="grid size-9 place-items-center rounded-xl bg-foreground text-background outline-none transition-transform hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-60"
            aria-label="Stop the answer (Esc)"
            title="Stop (Esc)"
            data-testid="chat-stop"
          >
            {stopping ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Square className="size-3.5 fill-current" aria-hidden />}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="grid size-9 place-items-center rounded-xl bg-brand text-brand-foreground outline-none transition-[transform,opacity] hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-35"
            aria-label="Send (Enter)"
            title="Send (Enter) · Shift+Enter for a new line"
            data-testid="chat-send"
          >
            {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
          </button>
        )}
      </div>
      {unavailable ? (
        <p className="flex items-center gap-1.5 px-2 pb-1 text-xs text-warn" role="status" data-testid="chat-unavailable">
          <TriangleAlert className="size-3.5" aria-hidden />
          {unavailable}
        </p>
      ) : null}
    </form>
  );
});
