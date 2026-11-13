import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { fail } from "@/server/api";
import { contentDisposition, streamFile } from "./serve";
import type { Viewer } from "@/server/viewer";

/**
 * `GET /api/hermes-chat/media?path=<server path>[&download=1]` (admins only): a media file of the server that Hermes
 * shows in the chat (a montage, a render, a picture it made), streamed with Range so the player can seek. Only media
 * extensions, only under the home, /srv, /mnt or /tmp, never inside a dot folder that holds secrets.
 */

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const SECRET_DIRS = new Set([".ssh", ".gnupg", ".config", ".aws", ".docker", ".kube", ".password-store"]);

export const chatMediaRoots = () => [os.homedir(), "/srv", "/mnt", "/tmp"];

/** The real file a `path` points to, or null when it is not a media file in an allowed place. */
export function resolveChatMedia(raw: unknown, roots = chatMediaRoots()): { file: string; size: number; type: string } | null {
  if (typeof raw !== "string" || !raw || raw.length > 1_000 || raw.includes("\0")) return null;
  const expanded = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  if (!path.isAbsolute(expanded)) return null;
  let real: string;
  try {
    real = fs.realpathSync(expanded);
  } catch {
    return null;
  }
  const type = TYPES[path.extname(real).toLowerCase()];
  if (!type) return null;
  const root = roots.map((r) => safeReal(r)).find((r) => r && (real === r || real.startsWith(r.endsWith("/") ? r : `${r}/`)));
  if (!root) return null;
  if (path.relative(root, real).split(path.sep).some((part) => SECRET_DIRS.has(part))) return null;
  const stat = fs.statSync(real);
  if (!stat.isFile()) return null;
  return { file: real, size: stat.size, type };
}

function safeReal(dir: string): string | null {
  try {
    return fs.realpathSync(dir);
  } catch {
    return null;
  }
}

export function serveChatMedia(viewer: Viewer, request: Request, roots = chatMediaRoots()): Response {
  if (viewer.role !== "admin") return fail(403, "forbidden", "For admins only");
  const url = new URL(request.url);
  const found = resolveChatMedia(url.searchParams.get("path"), roots);
  if (!found) return fail(404, "not_found", "File not found");
  const download = url.searchParams.get("download") === "1";
  const ranged = found.type.startsWith("video/") || found.type.startsWith("audio/");
  return streamFile(found.file, found.size, ranged ? request.headers.get("range") : null, {
    "Content-Type": found.type,
    "Content-Disposition": contentDisposition(path.basename(found.file), download),
    "Cache-Control": "private, max-age=60",
  });
}

/**
 * The page the chat's HTML previews run in, framed by the chat with `sandbox` (no allow-same-origin): an opaque origin,
 * so the HTML Hermes writes reaches neither the dashboard's cookies nor its API. The chat posts the HTML once the page says
 * it is ready; the page writes it and reports its height. Scripts from the usual CDNs may run, no fetch elsewhere.
 */
export const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://esm.sh",
  "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "img-src data: blob: https:",
  "media-src data: blob: https:",
  "connect-src https://cdn.jsdelivr.net https://esm.sh https://unpkg.com",
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com",
  "worker-src blob:",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads",
].join("; ");

/**
 * Appended to the HTML: reports the document's height to the chat (the frame grows with it, up to a cap). A page sized
 * on the viewport (`height: 100vh`) grows exactly as much as the frame does: once it does, it stops reporting, or the
 * frame would grow forever.
 */
const REPORTER = `<script>(function(){var last=0,lastVh=0,fixed=false;function send(){if(fixed)return;var vh=window.innerHeight,h=Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0);if(last&&vh!==lastVh&&h-last===vh-lastVh){fixed=true;return;}if(h!==last){last=h;lastVh=vh;parent.postMessage({type:"hub-frame-size",height:h},"*");}}window.addEventListener("load",send);if(window.ResizeObserver){new ResizeObserver(send).observe(document.documentElement);}setInterval(send,1000);send();})();</script>`;

export const FRAME_SHELL = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>(function(){var done=false;window.addEventListener("message",function(e){if(done||e.source!==parent||!e.data||e.data.type!=="hub-html"||typeof e.data.html!=="string")return;done=true;var html=e.data.html;document.open();document.write(html+${JSON.stringify(REPORTER).replace(/<\//g, "<\\/")});document.close();});parent.postMessage({type:"hub-frame-ready"},"*");})();</script></body></html>`;

export function serveChatFrame(viewer: Viewer): Response {
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": FRAME_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
  if (viewer.role !== "admin") return new Response("<p>For admins only</p>", { status: 403, headers });
  return new Response(FRAME_SHELL, { status: 200, headers });
}
