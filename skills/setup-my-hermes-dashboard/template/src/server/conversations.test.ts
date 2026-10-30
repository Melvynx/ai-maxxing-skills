import { describe, expect, it } from "vitest";

import { toConversations } from "./conversations";

describe("toConversations", () => {
  it("keeps visible sessions, newest first, with a readable title", () => {
    const list = toConversations({
      sessions: [
        { id: "a", source: "oneshot", title: null, preview: "Reply with OK", message_count: 2, last_active: 1_800_000_000 },
        { id: "b", source: "telegram", title: "Files on the VPS", display_name: "Melvyn", message_count: 39, last_active: 1_800_000_100, is_active: true },
        { id: "c", source: "cli", title: "Hidden", hidden: 1, last_active: 1_800_000_200 },
        { id: "d", source: "cli", title: "Archived", archived: true, last_active: 1_800_000_300 },
        { id: "e", source: "cli", started_at: "2026-10-01T00:00:00Z" },
      ],
    });
    expect(list.map((c) => c.id)).toEqual(["b", "a", "e"]);
    expect(list[0]).toMatchObject({ title: "Files on the VPS", who: "Melvyn", messages: 39, active: true, lastActive: 1_800_000_100_000 });
    expect(list[1]).toMatchObject({ title: "Reply with OK", who: null, active: false });
    expect(list[2]).toMatchObject({ title: "Untitled conversation", lastActive: Date.parse("2026-10-01T00:00:00Z") });
  });

  it("returns an empty list on an unexpected answer", () => {
    expect(toConversations(null)).toEqual([]);
    expect(toConversations({ sessions: "nope" })).toEqual([]);
  });
});
