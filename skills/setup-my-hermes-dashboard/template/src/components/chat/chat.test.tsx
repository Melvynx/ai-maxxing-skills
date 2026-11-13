import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { frameEvent, newTurn, reduceTurn, sseParser, type Turn } from "@/lib/chat/events";
import { APPROVAL_SSE, CLARIFY_SSE, FAILED_SSE } from "@/lib/chat/fixtures";
import type { ChatModel } from "@/lib/chat/items";
import { ChatSearchSchema } from "@/lib/chat/search";

import { Composer, ModelPicker } from "./composer";

import { groupByDate, matches, TitleInput } from "./conversations";
import { ListEta } from "./eta";
import { ChatMarkdown, splitBlocks } from "./markdown";
import { AssistantTurn, UserMessage } from "./thread";

const fold = (sse: string): Turn => {
  let turn = newTurn("run_fixture0001", "running");
  for (const frame of sseParser()(sse)) {
    const event = frameEvent(frame);
    if (event) turn = reduceTurn(turn, event);
  }
  return turn;
};

const MODELS: { current: { provider: string; model: string }; models: ChatModel[] } = {
  current: { provider: "acme", model: "big-model" },
  models: [
    { provider: "acme", providerName: "Acme", model: "big-model", reasoning: true, expensive: null },
    { provider: "acme", providerName: "Acme", model: "small-model", reasoning: false, expensive: null },
    { provider: "acme", providerName: "Acme", model: "pricey", reasoning: false, expensive: "pricey is expensive. Use it anyway?" },
  ],
};

describe("markdown", () => {
  it("cuts blocks on blank lines but never inside a code fence", () => {
    expect(splitBlocks("a\n\n```ts\nx\n\ny\n```\n\nb")).toEqual(["a", "```ts\nx\n\ny\n```", "b"]);
  });

  it("renders a table, a highlighted code block with a copy button, and safe links", () => {
    render(<ChatMarkdown text={"| Jour | Charge |\n|---|--:|\n| lun | 0,2 |\n\n```ts\nconst x: number = 1;\n```\n\n[site](https://example.com) [piège](javascript:alert(1))"} />);
    expect(screen.getByTestId("chat-table").querySelectorAll("tr")).toHaveLength(2);
    const code = screen.getByTestId("chat-code");
    expect(code).toHaveTextContent("ts");
    expect(code.querySelector(".hljs-keyword")).toHaveTextContent("const");
    expect(within(code).getByRole("button", { name: "Copy the code" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "site" })).toHaveAttribute("target", "_blank");
    expect(screen.getByText("piège").closest("a")?.getAttribute("href") ?? "").not.toMatch(/javascript/);
    // No inline style attribute anywhere: the CSP blocks them in server-rendered HTML.
    expect(document.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("keeps single line breaks", () => {
    render(<ChatMarkdown text={"un\ndeux\ntrois"} />);
    expect(screen.getByTestId("chat-markdown").querySelectorAll("br")).toHaveLength(2);
  });

  it("closes half-written markdown while streaming", () => {
    render(<ChatMarkdown text={"Voici **important"} streaming />);
    expect(screen.getByText("important").tagName).toBe("STRONG");
  });
});

describe("thread", () => {
  it("shows the comment and the steps apart from the answer, folded once answered", async () => {
    render(<AssistantTurn parts={[{ kind: "text", text: "Je regarde." }, { kind: "tool", id: "t1", name: "terminal", preview: "uptime", status: "done", duration: 0.2, result: "up 5 days" }, { kind: "text", text: "La charge est **faible**." }]} model="big-model" last onRegenerate={() => {}} />);
    expect(screen.getByTestId("chat-steps-folded")).toHaveTextContent("Used Terminal");
    expect(screen.getByTestId("chat-markdown")).toHaveTextContent("La charge est faible.");
    expect(screen.getByTestId("chat-markdown")).not.toHaveTextContent("Je regarde.");
    expect(screen.getByTestId("chat-model")).toHaveTextContent("big-model");
    await userEvent.click(screen.getByTestId("chat-steps-folded"));
    expect(screen.getByTestId("chat-commentary")).toHaveTextContent("Je regarde.");
    await userEvent.click(screen.getByRole("button", { name: /Terminal/ }));
    expect(screen.getByText("up 5 days")).toBeInTheDocument();
  });

  it("an approval card answers once or deny with Hermes's identity", async () => {
    const onApprove = vi.fn(async () => {});
    const turn = fold(APPROVAL_SSE);
    render(<AssistantTurn parts={turn.parts} model={null} live onApprove={onApprove} />);
    const card = screen.getByTestId("chat-approval");
    expect(card).toHaveTextContent("Hermes asks for your OK");
    expect(card).toHaveTextContent("rm -rf /tmp/build-cache");
    await userEvent.click(within(card).getByRole("button", { name: "Allow once" }));
    expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({ promptId: "prm_fixture1", generation: 3 }), "once");
    await userEvent.click(within(card).getByRole("button", { name: "Deny" }));
    expect(onApprove).toHaveBeenLastCalledWith(expect.anything(), "deny");
  });

  it("a question card sends a choice or a typed answer", async () => {
    const onClarify = vi.fn(async () => {});
    render(<AssistantTurn parts={fold(CLARIFY_SSE).parts} model={null} live onClarify={onClarify} />);
    await userEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(onClarify).toHaveBeenLastCalledWith(expect.objectContaining({ promptId: "clr_fixture1" }), "Yesterday");
    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "Le mois dernier{Enter}");
    expect(onClarify).toHaveBeenLastCalledWith(expect.anything(), "Le mois dernier");
  });

  it("says that a run failed, with Hermes's reason, and shows the failed step", () => {
    const turn = fold(FAILED_SSE);
    render(<AssistantTurn parts={turn.parts} status={turn.status} error={turn.error} model={null} />);
    expect(screen.getByTestId("chat-end")).toHaveTextContent("The answer failed.");
    expect(screen.getByTestId("chat-end")).toHaveTextContent("Provider returned 529 overloaded");
    expect(screen.getByTestId("chat-tool")).toHaveAttribute("data-status", "error");
  });

  it("shows the wait estimate during the whole live run, tools included, and never once it ended", () => {
    const now = Date.now();
    const parts = [{ kind: "tool" as const, id: "t1", name: "terminal", preview: "build", status: "running" as const }];
    const { rerender } = render(<AssistantTurn parts={parts} model={null} live eta={{ seconds: 150, at: now }} />);
    expect(screen.getByTestId("chat-eta")).toHaveTextContent("⏱️~3 min left");
    rerender(<AssistantTurn parts={[]} model={null} live eta={{ seconds: 300, at: now - 60_000, estimated: true }} />);
    expect(screen.getByTestId("chat-eta")).toHaveTextContent("~4 min (usual time)");
    rerender(<AssistantTurn parts={[]} model={null} live eta={{ seconds: 60, at: now - 120_000 }} />);
    expect(screen.getByTestId("chat-eta")).toHaveTextContent("Almost done…");
    rerender(<AssistantTurn parts={[{ kind: "text", text: "Fini." }]} model={null} eta={{ seconds: 60, at: now }} />);
    expect(screen.queryByTestId("chat-eta")).toBeNull();
  });

  it("counts down next to a running conversation in the list", () => {
    vi.useFakeTimers();
    const at = Date.now();
    render(<ListEta eta={{ seconds: 125, at }} />);
    expect(screen.getByTestId("chat-list-eta")).toHaveTextContent("⏱️ ~3 min");
    act(() => vi.advanceTimersByTime(70_000));
    expect(screen.getByTestId("chat-list-eta")).toHaveTextContent("⏱️ ~1 min");
    act(() => vi.advanceTimersByTime(30_000));
    expect(screen.getByTestId("chat-list-eta")).toHaveTextContent("⏱️ ~25 s");
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByTestId("chat-list-eta")).toHaveTextContent("⏱️ soon");
    vi.useRealTimers();
  });

  it("shows « Hermes is thinking… » until something arrives", () => {
    render(<AssistantTurn parts={[]} model={null} live />);
    expect(screen.getByTestId("chat-thinking")).toHaveTextContent("Hermes is thinking…");
  });

  it("edits the last message and sends it again", async () => {
    const onEdit = vi.fn();
    render(<UserMessage item={{ text: "Avant", images: [] }} canEdit onEdit={onEdit} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit and send again" }));
    const box = screen.getByRole("textbox", { name: "Edit the message" });
    await userEvent.clear(box);
    await userEvent.type(box, "Après{Enter}");
    expect(onEdit).toHaveBeenCalledWith("Après");
  });
});

describe("composer", () => {
  const props = { unavailable: null, running: false, stopping: false, onStop: vi.fn(), models: MODELS, choice: null, onChoice: vi.fn() };

  it("Enter sends, Shift+Enter goes to the next line, and the text clears once sent", async () => {
    const onSend = vi.fn(async () => true);
    render(<Composer {...props} onSend={onSend} />);
    const input = screen.getByTestId("chat-input");
    await userEvent.type(input, "Bonjour{Shift>}{Enter}{/Shift}Hermes");
    expect(input).toHaveValue("Bonjour\nHermes");
    await userEvent.type(input, "{Enter}");
    expect(onSend).toHaveBeenCalledWith("Bonjour\nHermes", []);
    expect(input).toHaveValue("");
  });

  it("keeps the text when sending failed", async () => {
    render(<Composer {...props} onSend={async () => false} />);
    await userEvent.type(screen.getByTestId("chat-input"), "Reste là{Enter}");
    expect(screen.getByTestId("chat-input")).toHaveValue("Reste là");
  });

  it("shows Stop while Hermes answers", async () => {
    const onStop = vi.fn();
    render(<Composer {...props} running onStop={onStop} onSend={async () => true} />);
    expect(screen.queryByTestId("chat-send")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Stop the answer/ }));
    expect(onStop).toHaveBeenCalled();
  });

  it("is clearly off when Hermes cannot be reached", () => {
    render(<Composer {...props} unavailable="Hermes ne répond pas." onSend={async () => true} />);
    expect(screen.getByTestId("chat-input")).toBeDisabled();
    expect(screen.getByTestId("chat-unavailable")).toHaveTextContent("Hermes ne répond pas.");
    expect(screen.getByTestId("chat-send")).toBeDisabled();
  });

  it("uploads a pasted file that is not an image and names it in the message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ path: "/data/chat-files/2026-11-12/ab12-doc.csv", name: "doc.csv", size: 4 }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSend = vi.fn(async () => true);
    render(<Composer {...props} onSend={onSend} />);
    const input = screen.getByTestId("chat-input");
    const csv = new File(["a,b\n"], "doc.csv", { type: "text/csv" });
    fireEvent.paste(input, { clipboardData: { files: [csv] } });
    expect(await screen.findByRole("button", { name: "Remove doc.csv" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText("Sending the file")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/hermes-chat/files", expect.objectContaining({ method: "POST" }));
    expect(screen.queryByRole("list", { name: "Attached images" })).toBeNull();
    fireEvent.change(input, { target: { value: "Voici les liens" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Voici les liens\n\n📎 Attached file: doc.csv → /data/chat-files/2026-11-12/ab12-doc.csv", []));
    vi.unstubAllGlobals();
  });

});

describe("model picker", () => {
  it("lists the main model first, picks another one, and offers the reasoning level only when the model takes it", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ModelPicker models={MODELS} choice={null} onChange={onChange} />);
    expect(screen.getByTestId("chat-model-picker")).toHaveTextContent("big-model");
    await userEvent.click(screen.getByTestId("chat-model-picker"));
    expect(screen.getByRole("option", { name: /Hermes's main model/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("chat-reasoning-level")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Deep" }));
    expect(onChange).toHaveBeenLastCalledWith({ provider: "acme", model: "big-model", reasoning: "high" });
    await userEvent.click(screen.getByRole("option", { name: "small-model" }));
    expect(onChange).toHaveBeenLastCalledWith({ provider: "acme", model: "small-model", reasoning: "default" });
    rerender(<ModelPicker models={MODELS} choice={{ provider: "acme", model: "small-model", reasoning: "default" }} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("chat-model-picker"));
    expect(screen.queryByTestId("chat-reasoning-level")).toBeNull();
  });

  it("asks before an expensive model, like the Models page", async () => {
    const onChange = vi.fn();
    render(<ModelPicker models={MODELS} choice={null} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("chat-model-picker"));
    await userEvent.click(screen.getByRole("option", { name: /pricey/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("pricey is expensive");
    await userEvent.click(screen.getByRole("button", { name: "Use pricey" }));
    expect(onChange).toHaveBeenCalledWith({ provider: "acme", model: "pricey", reasoning: "default" });
  });
});

describe("conversation list and URL", () => {
  it("groups by day and searches titles", () => {
    const now = new Date(2026, 10, 10, 12).getTime();
    const day = 86_400_000;
    const list = [
      { id: "c_1", title: "Ventes d'hier", updatedAt: now - 1_000, running: false },
      { id: "c_2", title: "Serveur", updatedAt: now - day, running: false },
      { id: "c_3", title: "Leads", updatedAt: now - 3 * day, running: false },
      { id: "c_4", title: "Vieux", updatedAt: now - 90 * day, running: false },
    ];
    expect(groupByDate(list, now).map((g) => [g.label, g.items.length])).toEqual([
      ["Today", 1],
      ["Yesterday", 1],
      ["Last 7 days", 1],
      ["August 2026", 1],
    ]);
    expect(list.filter((c) => matches(c, "VENTES")).map((c) => c.id)).toEqual(["c_1"]);
  });

  it("an old or broken link still opens", () => {
    expect(ChatSearchSchema.parse({ c: "c_0123456789abcdef", q: 12, list: 1 })).toEqual({ c: "c_0123456789abcdef", q: "12", list: 1 });
    expect(ChatSearchSchema.parse({ c: "../etc", list: "yes", demo: "boom" })).toEqual({});
  });
});

describe("bylines and titles", () => {
  it("shows « You » on the person's messages and Hermes on its answers", () => {
    render(<UserMessage item={{ text: "Hi", images: [] }} />);
    const user = screen.getByTestId("chat-user");
    expect(within(user).getByTestId("chat-byline")).toHaveTextContent("You");
    expect(within(user).getByTestId("chat-avatar")).toBeInTheDocument();
    render(<AssistantTurn parts={[{ kind: "text", text: "OK" }]} model={null} />);
    expect(within(screen.getByTestId("chat-assistant")).getByTestId("chat-byline")).toHaveTextContent("Hermes");
  });

  it("renames in place: Enter keeps the new title, Escape gives up, an unchanged title is not sent", async () => {
    const done = vi.fn();
    const { unmount } = render(<TitleInput title="Ancien" onDone={done} />);
    const input = screen.getByTestId("chat-rename-input");
    fireEvent.change(input, { target: { value: "  Nouveau   titre " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(done).toHaveBeenCalledWith("Nouveau titre");
    expect(done).toHaveBeenCalledTimes(1);
    unmount();
    const cancel = vi.fn();
    render(<TitleInput title="Ancien" onDone={cancel} />);
    await userEvent.type(screen.getByTestId("chat-rename-input"), "x{Escape}");
    expect(cancel).toHaveBeenCalledWith(null);
  });
});
