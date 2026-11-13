import { Code2, Download, Eye, Maximize2 } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Rich blocks in Hermes's answers: a video or audio player, a YouTube/Vimeo player, and live HTML (a mini app, a
 * chart, a mock-up) run in a sandboxed frame. Hermes writes them as markdown (see `richBlockKind`), the chat renders
 * them; anything else stays plain markdown.
 */

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)(?:$|[?#])/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|ogg)(?:$|[?#])/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)(?:$|[?#])/i;

/** Code fence languages that render instead of showing code. */
export const HTML_LANGS = new Set(["html-live", "live-html", "html-preview", "artifact"]);
export const VIDEO_LANGS = new Set(["video", "audio", "player", "media"]);

/** A server path (`/root/…`, `~/…`) goes through the chat's media route; a URL or a dashboard route stays as it is. */
export function mediaSrc(src: string): string {
  const value = src.trim();
  if (/^https?:\/\//i.test(value) || value.startsWith("/api/") || value.startsWith("data:") || value.startsWith("blob:")) return value;
  if (value.startsWith("/") || value.startsWith("~/")) return `/api/hermes-chat/media?path=${encodeURIComponent(value)}`;
  return value;
}

export function downloadSrc(src: string): string {
  const url = mediaSrc(src);
  if (!url.startsWith("/api/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

/** The id of a YouTube video (watch, youtu.be, shorts, embed, live), or null. */
export function youtubeId(src: string): { id: string; short: boolean; start: number | null } | null {
  let url: URL;
  try {
    url = new URL(src.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  let short = false;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) {
      id = parts[1] ?? null;
      short = parts[0] === "shorts";
    }
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const t = url.searchParams.get("t") ?? url.searchParams.get("start");
  const start = t ? Number.parseInt(t, 10) : NaN;
  return { id, short, start: Number.isFinite(start) && start > 0 ? start : null };
}

function vimeoId(src: string): string | null {
  return /^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{5,12})/i.exec(src.trim())?.[1] ?? null;
}

export type MediaKind = "video" | "audio" | "image" | "youtube" | "vimeo" | null;

/** What a link or image source is, judged on its address. A file extension decides. */
export function mediaKind(src: string): MediaKind {
  if (youtubeId(src)) return "youtube";
  if (vimeoId(src)) return "vimeo";
  const path = decodeSafe(src);
  if (VIDEO_EXT.test(path)) return "video";
  if (AUDIO_EXT.test(path)) return "audio";
  if (IMAGE_EXT.test(path)) return "image";
  return null;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A `video` fence: the address on the first line (or `src:`), then optional `title:` and `poster:` lines; or JSON. */
export function parseMediaBlock(code: string): { src: string; title?: string; poster?: string }[] {
  const text = code.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const value = JSON.parse(text) as unknown;
      const rows = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
      return rows.filter((r) => typeof r?.src === "string" && r.src).map((r) => ({ src: String(r.src), title: typeof r.title === "string" ? r.title : undefined, poster: typeof r.poster === "string" ? r.poster : undefined }));
    } catch {
      return [];
    }
  }
  const items: { src: string; title?: string; poster?: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const field = /^(src|title|titre|poster)\s*:\s*(.+)$/i.exec(line);
    if (field) {
      const key = field[1]!.toLowerCase();
      if (key === "src") items.push({ src: field[2]!.trim() });
      else if (items.length) items[items.length - 1]![key === "poster" ? "poster" : "title"] = field[2]!.trim();
      continue;
    }
    items.push({ src: line });
  }
  return items;
}

/** `MEDIA:/path` lines (Hermes's usual way to hand over a file) become images/players in the chat. */
export function mediaLines(text: string): string {
  return text.replace(/^[ \t]*MEDIA:[ \t]*(\S[^\n]*?)[ \t]*$/gm, (_, src: string) => `![](<${src}>)`);
}

export function ChatMedia({ src, title, poster }: { src: string; title?: string; poster?: string }) {
  const kind = mediaKind(src) ?? "video";
  if (kind === "youtube" || kind === "vimeo") return <EmbedPlayer src={src} title={title} />;
  const url = mediaSrc(src);
  return (
    <figure className="my-3 w-fit max-w-full first:mt-0" data-testid="chat-media">
      {kind === "audio" ? (
        <audio controls preload="metadata" src={url} className="w-[min(32rem,100%)]" data-testid="chat-audio" />
      ) : kind === "image" ? (
        <img src={url} alt={title ?? ""} className="max-h-[70vh] max-w-full rounded-xl border" loading="lazy" />
      ) : (
        <video controls playsInline preload="metadata" src={url} poster={poster ? mediaSrc(poster) : undefined} className="block max-h-[70vh] max-w-full rounded-xl border bg-black" data-testid="chat-video" />
      )}
      <figcaption className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
        {title ? <span className="min-w-0 truncate">{title}</span> : null}
        <a href={downloadSrc(src)} target="_blank" rel="noopener noreferrer" download className="ms-auto inline-flex shrink-0 items-center gap-1 hover:text-foreground">
          <Download className="size-3.5" aria-hidden />
          Download
        </a>
      </figcaption>
    </figure>
  );
}

function EmbedPlayer({ src, title }: { src: string; title?: string }) {
  const yt = youtubeId(src);
  const vimeo = vimeoId(src);
  const embed = yt ? `https://www.youtube-nocookie.com/embed/${yt.id}?rel=0${yt.start ? `&start=${yt.start}` : ""}` : `https://player.vimeo.com/video/${vimeo}`;
  return (
    <figure className={cn("my-3 max-w-full first:mt-0", yt?.short ? "w-[min(20rem,100%)]" : "w-[min(44rem,100%)]")} data-testid="chat-embed">
      <div className={cn("overflow-hidden rounded-xl border bg-black", yt?.short ? "aspect-[9/16]" : "aspect-video")}>
        <iframe
          src={embed}
          title={title ?? "Video"}
          className="size-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {title ? <figcaption className="mt-1.5 truncate text-xs text-muted-foreground">{title}</figcaption> : null}
    </figure>
  );
}

const MAX_FRAME = 1_400;

/**
 * Live HTML from Hermes in a frame of `/api/hermes-chat/frame` sandboxed without `allow-same-origin`: its scripts run
 * in an opaque origin (no dashboard cookie, no dashboard API). The frame says when it is ready, gets the HTML by postMessage and
 * reports its height. While the answer streams, a placeholder stands in (half an HTML page would flash).
 */
export function HtmlArtifact({ code, live, renderCode }: { code: string; live: boolean; renderCode: (code: string) => React.ReactNode }) {
  const [view, setView] = React.useState<"preview" | "code">("preview");
  const frame = React.useRef<HTMLIFrameElement>(null);
  const box = React.useRef<HTMLDivElement>(null);
  const title = /<title>([^<]{1,80})<\/title>/i.exec(code)?.[1]?.trim() || "HTML preview";

  React.useEffect(() => {
    if (live || view !== "preview") return;
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || event.source !== win) return;
      const data = event.data as { type?: string; height?: number } | null;
      if (data?.type === "hub-frame-ready") win.postMessage({ type: "hub-html", html: code }, "*");
      else if (data?.type === "hub-frame-size" && typeof data.height === "number" && frame.current)
        frame.current.style.height = `${Math.min(MAX_FRAME, Math.max(120, Math.ceil(data.height) + 2))}px`;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [code, live, view]);

  const lines = code.split("\n").length;
  return (
    <div ref={box} className="my-3 overflow-hidden rounded-xl border bg-background first:mt-0" data-testid="chat-artifact">
      <div className="flex h-9 items-center gap-1 border-b bg-muted/60 px-3">
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{title}</span>
        {!live ? (
          <div className="ms-auto flex items-center gap-0.5">
            <ToolButton onClick={() => setView(view === "preview" ? "code" : "preview")} label={view === "preview" ? "Show the code" : "Show the preview"}>
              {view === "preview" ? <Code2 className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            </ToolButton>
            {view === "preview" ? (
              <ToolButton onClick={() => void box.current?.requestFullscreen?.().catch(() => null)} label="Full screen">
                <Maximize2 className="size-3.5" aria-hidden />
              </ToolButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {live ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground" data-testid="chat-artifact-pending">
          Hermes is writing the preview… ({lines} line{lines > 1 ? "s" : ""})
        </div>
      ) : view === "code" ? (
        <div className="[&>div]:my-0 [&>div]:rounded-none [&>div]:border-0">{renderCode(code)}</div>
      ) : (
        <iframe
          ref={frame}
          src="/api/hermes-chat/frame"
          title={title}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
          className="block h-[420px] w-full bg-white [:fullscreen_&]:h-full!"
          data-testid="chat-artifact-frame"
        />
      )}
    </div>
  );
}

function ToolButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </button>
  );
}
