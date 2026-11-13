import { etaLabel, etaTracker, parseEta, pickEta, remainingLabel, remainingShort, typicalSeconds, withoutEta } from "@/lib/chat/eta";

describe("parseEta", () => {
  it("reads Hermes's estimate lines in their usual forms", () => {
    expect(parseEta("⏱️ Estimation : ~3 min\n\nJe commence.")).toBe(180);
    expect(parseEta("⏱️ Plus que ~1 min")).toBe(60);
    expect(parseEta("⏱️ ~45 s")).toBe(45);
    expect(parseEta("⏱️ Estimation : ~1 h")).toBe(3600);
    expect(parseEta("⏱️ Estimation : 2-3 min")).toBe(180);
    expect(parseEta("⏱️ Estimation : 2 à 3 minutes")).toBe(180);
    expect(parseEta("⏱️ Estimation : ~1,5 min")).toBe(90);
    expect(parseEta("⏱️ Estimation : ~1 h 30")).toBe(5400);
    expect(parseEta("Estimation : environ 10 secondes")).toBe(10);
    expect(parseEta("plus que ~2 min avant la fin")).toBe(120);
  });

  it("returns the last estimate of the text, the first amount of its line", () => {
    expect(parseEta("⏱️ Estimation : ~5 min\nJe lance le build (2 min).\n⏱️ Plus que ~2 min (1 min de tests)\nSuite.")).toBe(120);
  });

  it("ignores amounts outside estimate lines, and lines without a duration", () => {
    expect(parseEta("Le build a pris 3 min.")).toBeNull();
    expect(parseEta("⏱️ Estimation : bientôt")).toBeNull();
    expect(parseEta("Plus que 3 fichiers à traiter")).toBeNull();
    expect(parseEta("⏱️ Estimation : ~3 semaines")).toBeNull();
    expect(parseEta("")).toBeNull();
  });

  it("does not read a half-streamed amount", () => {
    expect(parseEta("⏱️ Estimation : ~1")).toBeNull();
    expect(parseEta("⏱️ Estimation : ~3 m")).toBeNull();
  });
});

describe("etaTracker", () => {
  it("gives a new value only when Hermes writes a different estimate, across chunk cuts", () => {
    const track = etaTracker();
    expect(track("⏱️ Estim")).toBeNull();
    expect(track("ation : ~1")).toBeNull();
    expect(track("0 min\n\nJe regarde")).toBe(600);
    expect(track(" les fichiers.\n")).toBeNull();
    expect(track("⏱️ Plus que ~10 min\n")).toBeNull();
    expect(track("⏱️ Plus que ~4 min\n")).toBe(240);
  });

  it("starts from the value already stored", () => {
    const track = etaTracker(240);
    expect(track("⏱️ Plus que ~4 min\n")).toBeNull();
  });
});

describe("remaining labels", () => {
  const at = 1_000_000;
  it("counts down in minutes, then seconds, then says it is nearly done", () => {
    expect(remainingLabel(180, at, at)).toBe("~3 min left");
    expect(remainingLabel(180, at, at + 61_000)).toBe("~2 min left");
    expect(remainingLabel(180, at, at + 140_000)).toBe("~40 s left");
    expect(remainingLabel(180, at, at + 179_000)).toBe("~5 s left");
    expect(remainingLabel(180, at, at + 180_000)).toBe("Almost done…");
    expect(remainingLabel(180, at, at + 999_000)).toBe("Almost done…");
    expect(remainingShort(5400, at, at)).toBe("~1 h 30");
    expect(remainingShort(3600, at, at)).toBe("~1 h");
  });

  it("flags the usual duration", () => {
    expect(etaLabel({ seconds: 300, at, estimated: true }, at + 60_000)).toBe("~4 min (usual time)");
    expect(etaLabel({ seconds: 300, at }, at + 60_000)).toBe("~4 min left");
    expect(etaLabel({ seconds: 300, at, estimated: true }, at + 400_000)).toBe("Almost done…");
  });
});

describe("typicalSeconds", () => {
  it("is the median duration, clamped to 20 s..15 min", () => {
    expect(typicalSeconds([])).toBeNull();
    expect(typicalSeconds([60_000, 120_000, 600_000])).toBe(120);
    expect(typicalSeconds([60_000, 120_000])).toBe(90);
    expect(typicalSeconds([3_000])).toBe(20);
    expect(typicalSeconds([3_600_000])).toBe(900);
  });
});

describe("pickEta", () => {
  it("prefers the live estimate, keeping the server's time when it is the same value", () => {
    const stored = { seconds: 120, at: 500 };
    expect(pickEta({ seconds: 120, seenAt: 900 }, stored)).toBe(stored);
    expect(pickEta({ seconds: 60, seenAt: 900 }, stored)).toEqual({ seconds: 60, at: 900 });
    expect(pickEta({ seconds: 120, seenAt: 900 }, { seconds: 120, at: 500, estimated: true })).toEqual({ seconds: 120, at: 900 });
    expect(pickEta(null, stored)).toBe(stored);
    expect(pickEta(null, null)).toBeNull();
  });
});

describe("withoutEta", () => {
  it("drops the stopwatch lines and keeps the rest", () => {
    expect(withoutEta("⏱️ Estimate: ~3 min\n\nLooking at your backups.")).toBe("Looking at your backups.");
    expect(withoutEta("Step 2 done.\n⏱️ ~1 min left\nNext: the logs.")).toBe("Step 2 done.\nNext: the logs.");
    expect(withoutEta("**⏱️ ~2 min left**")).toBe("");
    expect(withoutEta("No estimate here.")).toBe("No estimate here.");
  });
});
