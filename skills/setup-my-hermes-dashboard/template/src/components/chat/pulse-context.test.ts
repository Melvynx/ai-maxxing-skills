import { endLabel, newAnswers } from "./pulse-context";

const A = { id: "c_0000000000000001", title: "Rapport", endedAt: 10, status: "completed" };
const B = { id: "c_0000000000000002", title: "Montage", endedAt: 20, status: "failed" };

describe("newAnswers", () => {
  it("the first visit only remembers the backlog, then each new end rings once", () => {
    const first = newAnswers([A], null);
    expect(first.fresh).toEqual([]);
    const second = newAnswers([A, B], first.seen);
    expect(second.fresh).toEqual([B]);
    expect(newAnswers([A, B], second.seen).fresh).toEqual([]);
    // The same conversation answering again later is new again.
    expect(newAnswers([{ ...A, endedAt: 30 }], second.seen).fresh).toHaveLength(1);
  });
  it("says how it ended", () => {
    expect(endLabel("completed")).toBe("Hermes is done");
    expect(endLabel("failed")).toBe("Hermes stopped");
  });
});
