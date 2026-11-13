import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import * as React from "react";

/**
 * Code colouring for the Chat: highlight.js grammars through lowlight, a few languages only (the ones Hermes writes),
 * as `hljs-*` classes coloured by the tokens in styles.css (no inline style: the CSP blocks them in server HTML).
 */
const lowlight = createLowlight({ bash, css, diff, javascript, json, markdown, python, sql, typescript, xml, yaml });
lowlight.registerAlias({ bash: ["sh", "shell", "zsh", "console"], javascript: ["js", "jsx", "mjs"], typescript: ["ts", "tsx"], xml: ["html", "svg"], yaml: ["yml"], markdown: ["md"], python: ["py"] });

/** The bits of lowlight's tree (hast) used here. */
type Node = { type: string; value?: string; properties?: { className?: unknown }; children?: Node[] };

export const knownLanguage = (lang: string) => Boolean(lang) && lowlight.registered(lang);

function render(nodes: Node[], key = "h"): React.ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === "text") return node.value ?? "";
    if (node.type !== "element") return null;
    const names = node.properties?.className;
    return (
      <span key={`${key}-${i}`} className={Array.isArray(names) ? names.join(" ") : undefined}>
        {render(node.children ?? [], `${key}-${i}`)}
      </span>
    );
  });
}

/** The code as coloured spans; plain text for an unknown language or a block too big to colour quickly. */
export function highlight(code: string, lang: string): React.ReactNode {
  if (!knownLanguage(lang) || code.length > 60_000) return code;
  try {
    return render(lowlight.highlight(lang, code).children as Node[]);
  } catch {
    return code;
  }
}
