import fs from "node:fs";
import { Readable } from "node:stream";

/**
 * A file of the server's disk for the browser, with Range support so a video player can seek: 206 for a range, 416 for
 * one outside the file, 200 for the whole file.
 */
export function streamFile(file: string, size: number, rangeHeader: string | null, headers: Record<string, string>): Response {
  const out: Record<string, string> = { "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", ...headers };
  const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? "");
  let start = 0;
  let end = size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else start = Math.max(0, size - Number(range[2]));
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    out["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  out["Content-Length"] = String(Math.max(0, end - start + 1));
  if (size === 0) return new Response(null, { status: 200, headers: out });
  const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
  return new Response(body, { status: out["Content-Range"] ? 206 : 200, headers: out });
}

/** `Content-Disposition` for a file name: an ASCII fallback plus the exact name as `filename*` (RFC 5987). */
export function contentDisposition(name: string, download: boolean): string {
  const ascii =
    name
      .normalize("NFD")
      .replace(/[^\x20-\x7e]+/g, "")
      .replace(/["\\]/g, "")
      .trim() || "file";
  return `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
