import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FRAME_SHELL, resolveChatMedia, serveChatFrame, serveChatMedia } from "./media";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-media-"));
fs.mkdirSync(path.join(root, "clips"), { recursive: true });
fs.mkdirSync(path.join(root, ".ssh"), { recursive: true });
fs.writeFileSync(path.join(root, "clips/clip.mp4"), Buffer.alloc(1000, 1));
fs.writeFileSync(path.join(root, "clips/notes.txt"), "secret");
fs.writeFileSync(path.join(root, ".ssh/key.png"), "x");
const ADMIN = { email: "a@x.com", role: "admin" } as const;

describe("chat media", () => {
  it("serves media files under the allowed roots only", () => {
    expect(resolveChatMedia(path.join(root, "clips/clip.mp4"), [root])?.type).toBe("video/mp4");
    expect(resolveChatMedia(path.join(root, "clips/notes.txt"), [root])).toBeNull();
    expect(resolveChatMedia(path.join(root, ".ssh/key.png"), [root])).toBeNull();
    expect(resolveChatMedia(path.join(root, "clips/../clips/clip.mp4"), ["/nowhere"])).toBeNull();
    expect(resolveChatMedia("clips/clip.mp4", [root])).toBeNull();
  });

  it("streams a range for admins and refuses members", async () => {
    const url = `http://h/api/hermes-chat/media?path=${encodeURIComponent(path.join(root, "clips/clip.mp4"))}`;
    const part = serveChatMedia(ADMIN as never, new Request(url, { headers: { range: "bytes=0-99" } }), [root]);
    expect(part.status).toBe(206);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect(serveChatMedia({ email: "m@x.com", role: "member" } as never, new Request(url), [root]).status).toBe(403);
  });

  it("gives the sandboxed frame its own CSP", () => {
    const answer = serveChatFrame(ADMIN as never);
    expect(answer.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(answer.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    // The reporter script is escaped inside the shell's script.
    expect(FRAME_SHELL.match(/<\/script>/g)?.length).toBe(1);
  });
});
