import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { safeName, saveChatFile } from "./files";

describe("chat files", () => {
  it("keeps an accepted file under chat-files/<day> and refuses the others", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-files-"));
    const saved = saveChatFile(dir, "liens courts.csv", Buffer.from("slug,url\nabc,https://x").toString("base64"), new Date("2026-11-12T10:00:00Z"));
    expect(saved.path.startsWith(path.join(dir, "chat-files", "2026-11-12"))).toBe(true);
    expect(fs.readFileSync(saved.path, "utf8")).toBe("slug,url\nabc,https://x");
    expect(() => saveChatFile(dir, "virus.exe", "AAAA")).toThrow(/not accepted/);
    expect(() => saveChatFile(dir, "vide.csv", "")).toThrow(/vide/);
    expect(safeName("../../etc/passwd.csv")).toBe("passwd.csv");
  });
});
