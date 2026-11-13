import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatMarkdown } from "./markdown";
import { mediaKind, mediaLines, mediaSrc, parseMediaBlock, youtubeId } from "./rich";

describe("chat rich blocks", () => {
  it("routes server paths through the media route and keeps URLs", () => {
    expect(mediaSrc("/root/.local/share/clips/clips/a/clip.mp4")).toBe("/api/hermes-chat/media?path=%2Froot%2F.local%2Fshare%2Fclips%2Fclips%2Fa%2Fclip.mp4");
    expect(mediaSrc("https://x.com/a.mp4")).toBe("https://x.com/a.mp4");
    expect(mediaSrc("/api/clips/file?path=clips/a/clip.mp4")).toBe("/api/clips/file?path=clips/a/clip.mp4");
  });

  it("knows videos, audio and YouTube links", () => {
    expect(mediaKind("/root/a/clip.mp4")).toBe("video");
    expect(mediaKind("/api/clips/file?path=clips/a/clip.mp4")).toBe("video");
    expect(mediaKind("https://x.com/a.mp3")).toBe("audio");
    expect(mediaKind("https://youtu.be/J8UhtHXnMXg")).toBe("youtube");
    expect(youtubeId("https://www.youtube.com/shorts/J8UhtHXnMXg")).toEqual({ id: "J8UhtHXnMXg", short: true, start: null });
    expect(youtubeId("https://www.youtube.com/watch?v=J8UhtHXnMXg&t=42")?.start).toBe(42);
  });

  it("parses video fences and MEDIA lines", () => {
    expect(parseMediaBlock("/root/a.mp4\ntitle: Le clip\n/root/b.mp4")).toEqual([{ src: "/root/a.mp4", title: "Le clip" }, { src: "/root/b.mp4" }]);
    expect(parseMediaBlock('{"src":"/root/a.mp4","title":"T"}')).toEqual([{ src: "/root/a.mp4", title: "T", poster: undefined }]);
    expect(mediaLines("Voilà\nMEDIA:/root/a b.mp4\nfin")).toBe("Voilà\n![](</root/a b.mp4>)\nfin");
  });

  it("renders a player, a YouTube embed and a sandboxed HTML preview", () => {
    const text = "```video\n/root/a/clip.mp4\ntitle: Dernier montage\n```\n\n![Vidéo](https://youtu.be/J8UhtHXnMXg)\n\n```html-live\n<!doctype html><title>Simu</title><button>ok</button>\n```";
    render(<ChatMarkdown text={text} />);
    expect(screen.getByTestId("chat-video").getAttribute("src")).toBe("/api/hermes-chat/media?path=%2Froot%2Fa%2Fclip.mp4");
    expect(screen.getByText("Dernier montage")).toBeTruthy();
    expect(screen.getByTestId("chat-embed").querySelector("iframe")?.getAttribute("src")).toContain("youtube-nocookie.com/embed/J8UhtHXnMXg");
    const frame = screen.getByTestId("chat-artifact-frame");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("src")).toBe("/api/hermes-chat/frame");
  });

  it("waits for the end of the stream before running HTML", () => {
    render(<ChatMarkdown text={"```html-live\n<div>en cours"} streaming />);
    expect(screen.getByTestId("chat-artifact-pending")).toBeTruthy();
    expect(screen.queryByTestId("chat-artifact-frame")).toBeNull();
  });

  it("keeps plain html fences as code", () => {
    render(<ChatMarkdown text={"```html\n<b>x</b>\n```"} />);
    expect(screen.getByTestId("chat-code")).toBeTruthy();
  });
});
