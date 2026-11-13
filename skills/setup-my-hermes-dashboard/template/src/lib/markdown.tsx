import * as React from "react";

/**
 * A tiny markdown renderer for short trusted texts (the Miniatures charte): `#`-`###` headings, `-`/`*` bullets (one
 * level of nesting by indent), `1.` numbered lists, paragraphs, **bold**, *italic* and `code`. React elements only, no
 * HTML string, so nothing in the text can inject markup.
 */

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|(?<![\w*])\*(?!\s)(.+?)\*(?!\w)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={m.index} className="rounded bg-muted px-1 font-mono text-[0.9em]">{m[2]}</code>);
    else out.push(<em key={m.index}>{m[3]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Item = { text: string; children: string[] };
type Block = { type: "h"; level: number; text: string } | { type: "p"; text: string } | { type: "ul" | "ol"; items: Item[] };

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of source.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    const list = bullet ?? numbered;
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      blocks.push({ type: "h", level: heading[1].length, text: heading[2] });
    } else if (list) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const prev = blocks[blocks.length - 1];
      const nested = list[1].length >= 2 && prev && (prev.type === "ul" || prev.type === "ol") && prev.items.length > 0;
      if (nested) prev.items[prev.items.length - 1].children.push(list[2]);
      else if (prev && prev.type === kind) prev.items.push({ text: list[2], children: [] });
      else blocks.push({ type: kind, items: [{ text: list[2], children: [] }] });
    } else {
      const prev = blocks[blocks.length - 1];
      // A wrapped line right under a list item continues it.
      if (!para.length && /^\s+\S/.test(raw) && prev && (prev.type === "ul" || prev.type === "ol")) prev.items[prev.items.length - 1].text += ` ${line.trim()}`;
      else para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

const HEADING = ["text-base font-semibold", "text-sm font-semibold mt-2", "text-sm font-medium mt-1"];

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={["grid gap-2.5 text-sm leading-relaxed text-pretty", className].filter(Boolean).join(" ")} data-testid="markdown">
      {blocks.map((block, i) => {
        if (block.type === "h") {
          const Tag = (`h${Math.min(6, block.level + 2)}` as "h3");
          return (
            <Tag key={i} className={HEADING[Math.min(2, block.level - 1)]}>
              {inline(block.text)}
            </Tag>
          );
        }
        if (block.type === "p") return <p key={i}>{inline(block.text)}</p>;
        const List = block.type;
        return (
          <List key={i} className={List === "ul" ? "grid list-disc gap-1 pl-5 marker:text-muted-foreground" : "grid list-decimal gap-1 pl-5 marker:text-muted-foreground"}>
            {block.items.map((item, j) => (
              <li key={j}>
                {inline(item.text)}
                {item.children.length ? (
                  <ul className="mt-1 grid list-[circle] gap-1 pl-5 marker:text-muted-foreground">
                    {item.children.map((child, k) => (
                      <li key={k}>{inline(child)}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
