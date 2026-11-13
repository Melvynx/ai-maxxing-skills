import { render, screen } from "@testing-library/react";

import { Markdown, parseMarkdown } from "./markdown";

const CHARTE = `# Charte
## Typographie
- Deux familles :
  - sans-serif **très grasse** ;
  - serif en *italique*.
- Paire Inter + Times

1. Lifestyle
2. Marché
Texte <b>pas du HTML</b>`;

describe("Markdown", () => {
  it("parses headings, nested bullets and numbered lists", () => {
    const blocks = parseMarkdown(CHARTE);
    expect(blocks.map((b) => b.type)).toEqual(["h", "h", "ul", "ol", "p"]);
    expect(blocks[2]).toEqual({ type: "ul", items: [{ text: "Deux familles :", children: ["sans-serif **très grasse** ;", "serif en *italique*."] }, { text: "Paire Inter + Times", children: [] }] });
  });

  it("renders bold and never raw HTML", () => {
    render(<Markdown text={CHARTE} />);
    expect(screen.getByText("très grasse").tagName).toBe("STRONG");
    expect(screen.getByText("italique").tagName).toBe("EM");
    expect(screen.getByRole("heading", { name: "Charte" })).toBeInTheDocument();
    expect(screen.getByText(/pas du HTML/).textContent).toContain("<b>");
  });
});
