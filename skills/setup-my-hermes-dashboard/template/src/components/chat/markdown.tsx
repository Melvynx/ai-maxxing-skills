import { Check, Copy } from "lucide-react";
import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remend from "remend";

import { cn } from "@/lib/utils";

import { highlight } from "./highlight";
import { CHART_LANGS, ChatChart, ChatStats, parseChart, parseStats, STATS_LANGS } from "./chart";
import { ChatMedia, HTML_LANGS, HtmlArtifact, mediaKind, mediaLines, mediaSrc, parseMediaBlock, VIDEO_LANGS } from "./rich";

/** True for the block still being written (the last one while Hermes streams). */
const LiveBlock = React.createContext(false);

/**
 * Hermes's answers as markdown (GFM: tables, task lists, autolinks), React elements only (no raw HTML). Rich blocks
 * (rich.tsx): an image whose address is a video, audio or YouTube link plays; a ```video fence is a player; a
 * ```html-live fence runs in a sandboxed frame; a `MEDIA:/path` line shows that server file. While the
 * answer streams, `remend` closes what is half written (`**`, a code fence, a link) and the text is cut in blocks:
 * finished blocks are memoised, only the last one renders again, so nothing above it moves.
 */

/** Blocks separated by blank lines outside code fences. */
export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    }
    if (!fence && !marker && !line.trim()) {
      if (current.length) blocks.push(current.join("\n"));
      current = [];
    } else current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = "Copy", className, children }: { text: string; label?: string; className?: string; children?: React.ReactNode }) {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1_500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <button
      type="button"
      onClick={async () => setDone(await copyText(text))}
      className={cn("inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)}
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
    >
      {done ? <Check className="size-3.5 text-good" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {children}
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="group/code my-3 overflow-hidden rounded-xl border bg-muted/50 first:mt-0" data-testid="chat-code">
      <div className="flex h-9 items-center justify-between border-b bg-muted/60 px-3">
        <span className="font-mono text-xs text-muted-foreground">{lang || "text"}</span>
        <CopyButton text={code} label="Copy the code" className="h-7 px-1.5">
          <span>Copy</span>
        </CopyButton>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[0.8125rem] leading-relaxed">
        <code className="hljs">{highlight(code, lang)}</code>
      </pre>
    </div>
  );
}

function RichPre({ code, lang }: { code: string; lang: string }) {
  const live = React.useContext(LiveBlock);
  if (HTML_LANGS.has(lang)) return <HtmlArtifact code={code} live={live} renderCode={(c) => <CodeBlock code={c} lang="html" />} />;
  // A chart or stats block shows as code while Hermes still writes it, then turns into the drawing.
  if (CHART_LANGS.has(lang) && !live) {
    const spec = parseChart(code);
    if (spec) return <ChatChart spec={spec} />;
  }
  if (STATS_LANGS.has(lang) && !live) {
    const tiles = parseStats(code);
    if (tiles) return <ChatStats tiles={tiles} />;
  }
  if (VIDEO_LANGS.has(lang)) {
    const items = live ? [] : parseMediaBlock(code);
    if (items.length) return <>{items.map((item, i) => <ChatMedia key={`${i}-${item.src}`} {...item} />)}</>;
  }
  return <CodeBlock code={code} lang={lang} />;
}

const COMPONENTS: Components = {
  h1: ({ children }) => <h2 className="mt-5 mb-2 font-heading text-lg font-semibold tracking-[-0.01em] first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 font-heading text-md font-semibold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-md font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h5>,
  h5: ({ children }) => <h6 className="mt-3 mb-1 font-semibold first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-3 mb-1 font-semibold text-muted-foreground first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children, className }) => <ul className={cn("my-3 grid gap-1.5 pl-6 first:mt-0 last:mb-0", className?.includes("contains-task-list") ? "list-none pl-1" : "list-disc marker:text-muted-foreground")}>{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} className="my-3 grid list-decimal gap-1.5 pl-6 marker:text-muted-foreground first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1 [&>ol]:my-1.5 [&>p]:my-1 [&>ul]:my-1.5">{children}</li>,
  input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} readOnly disabled className="me-1.5 size-3.5 translate-y-0.5 accent-brand" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-ink underline decoration-brand/40 underline-offset-2 hover:decoration-brand">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="my-3 border-s-2 border-brand/50 ps-4 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-5 border-border" />,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border first:mt-0" data-testid="chat-table">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60 text-left">{children}</thead>,
  th: ({ children, style }) => <th className={cn("border-b px-3 py-2 font-semibold whitespace-nowrap", style?.textAlign === "right" && "text-right", style?.textAlign === "center" && "text-center")}>{children}</th>,
  td: ({ children, style }) => <td className={cn("border-b px-3 py-2 align-top [tr:last-child_&]:border-b-0", style?.textAlign === "right" && "text-right tabular-nums", style?.textAlign === "center" && "text-center")}>{children}</td>,
  pre: ({ children }) => {
    const code = React.Children.toArray(children)[0] as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;
    const lang = /language-([\w+-]+)/.exec(code?.props.className ?? "")?.[1]?.toLowerCase() ?? "";
    const text = String(code?.props.children ?? "").replace(/\n$/, "");
    return <RichPre code={text} lang={lang} />;
  },
  code: ({ children }) => <code className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[0.85em] box-decoration-clone">{children}</code>,
  img: ({ src, alt }) => {
    if (typeof src !== "string" || !src) return null;
    const kind = mediaKind(src);
    if (kind && kind !== "image") return <ChatMedia src={src} title={alt || undefined} />;
    if (!/^(https?:|data:image\/|\/|~\/)/.test(src)) return null;
    return <img src={mediaSrc(src)} alt={alt ?? ""} className="my-3 max-h-96 max-w-full rounded-lg border" loading="lazy" />;
  },
};

type MdNode = { type: string; value?: string; children?: MdNode[] };

/**
 * A single line break in Hermes's text stays a line break (« un par ligne »), as in chat apps; markdown alone would
 * join the lines. The same as remark-breaks, in a few lines.
 */
export function remarkLineBreaks() {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text" || !child.value?.includes("\n")) {
        walk(child);
        return [child];
      }
      return child.value.split("\n").flatMap((part, i) => (i === 0 ? [{ type: "text", value: part }] : [{ type: "break" }, { type: "text", value: part }]));
    });
  };
  return (tree: MdNode) => walk(tree);
}

const PLUGINS = [remarkGfm, remarkLineBreaks];

const Block = React.memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});

export function ChatMarkdown({ text, streaming = false, className }: { text: string; streaming?: boolean; className?: string }) {
  const blocks = React.useMemo(() => splitBlocks(mediaLines(streaming ? remend(text) : text)), [text, streaming]);
  return (
    <div className={cn("chat-markdown min-w-0 text-[0.9375rem] leading-[1.7] break-words text-foreground [&>*:first-child>*:first-child]:mt-0", className)} data-testid="chat-markdown">
      {blocks.map((block, i) => (
        <div key={i} className="[&+div]:mt-3">
          <LiveBlock.Provider value={streaming && i === blocks.length - 1}>
            <Block text={block} />
          </LiveBlock.Provider>
        </div>
      ))}
    </div>
  );
}
