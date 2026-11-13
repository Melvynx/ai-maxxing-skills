import { render, screen } from "@testing-library/react";

import { niceMax, parseChart, parseStats, withUnit } from "./chart";
import { ChatMarkdown } from "./markdown";

// jsdom has no ResizeObserver; the chart only needs it to follow the box's width.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

describe("generative blocks", () => {
  it("reads a chart in both shapes and refuses broken JSON", () => {
    expect(parseChart('{"type":"line","labels":["Mon","Tue"],"series":[{"name":"Sales","values":[3,"5"]}]}')).toMatchObject({ type: "line", labels: ["Mon", "Tue"], series: [{ name: "Sales", values: [3, 5] }] });
    expect(parseChart('{"type":"pie","data":[{"label":"A","value":2},{"label":"B","value":1}]}')).toMatchObject({ type: "donut", labels: ["A", "B"], series: [{ values: [2, 1] }] });
    expect(parseChart('{"type":"bar","series":[')).toBeNull();
    expect(parseChart('{"type":"bar","series":[]}')).toBeNull();
  });

  it("formats units and rounds the axis", () => {
    expect(withUnit(1240, "$")).toBe("$1,240");
    expect(withUnit(1240, "€", true)).toBe("1.2K €");
    expect(withUnit(45, "%")).toBe("45%");
    expect([niceMax(0), niceMax(7), niceMax(430)]).toEqual([1, 8, 500]);
  });

  it("reads stats tiles", () => {
    expect(parseStats('[{"label":"Revenue","value":"$1,240","delta":"+12%","tone":"good"},{"label":"x"}]')).toEqual([{ label: "Revenue", value: "$1,240", delta: "+12%", tone: "good", hint: undefined }]);
    expect(parseStats('{"stats":[{"label":"CPU","value":42}]}')).toEqual([{ label: "CPU", value: "42", delta: undefined, tone: undefined, hint: undefined }]);
    expect(parseStats("nope")).toBeNull();
  });

  it("draws chart and stats blocks once written, and shows the code while Hermes still writes", () => {
    const md = '```chart\n{"type":"bar","title":"Sales","labels":["Mon","Tue"],"series":[{"name":"Sales","values":[3,5]}]}\n```\n\n```stats\n[{"label":"CPU","value":"42%","delta":"-3%"},{"label":"RAM","value":"61%"}]\n```';
    const { unmount } = render(<ChatMarkdown text={md} />);
    expect(screen.getByTestId("chat-chart")).toHaveAttribute("data-type", "bar");
    expect(screen.getByRole("img", { name: /Sales Mon 3/ })).toBeInTheDocument();
    expect(screen.getByTestId("chat-stats")).toHaveTextContent("CPU42%-3%RAM61%");
    unmount();
    render(<ChatMarkdown text={'```chart\n{"type":"bar","labels":["Mon"'} streaming />);
    expect(screen.queryByTestId("chat-chart")).toBeNull();
  });
});
