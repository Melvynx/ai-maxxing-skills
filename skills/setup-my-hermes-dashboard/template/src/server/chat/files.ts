import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ChatError } from "./hermes-api";

/**
 * Files (CSV, Excel, PDF…) joined to a dashboard chat message: kept on the server under `<dataDir>/chat-files/<day>/` and
 * named in the message, so Hermes reads them with its own tools. Images keep their own path (sent to the model).
 */

export const MAX_FILE_BYTES = 15_000_000;
export const FILE_EXTENSIONS = ["csv", "tsv", "txt", "md", "json", "xlsx", "xls", "ods", "pdf", "docx", "doc", "pptx", "zip", "xml", "html"];

export type SavedFile = { path: string; name: string; size: number };

/** A file name safe on disk: no folder, no odd character, its extension kept. */
export function safeName(name: string): string {
  const base = path.basename(name.normalize("NFC")).replace(/[^\w.\- ()àâäéèêëîïôöùûüç]+/gi, "_").replace(/^\.+/, "").slice(-120);
  return base || "file";
}

export function saveChatFile(dataDir: string, name: string, base64: string, now = new Date()): SavedFile {
  const clean = safeName(name);
  const ext = path.extname(clean).slice(1).toLowerCase();
  if (!FILE_EXTENSIONS.includes(ext)) throw new ChatError("rejected", `"${name}": this file type is not accepted (${FILE_EXTENSIONS.join(", ")}).`, 400);
  if (!/^[A-Za-z0-9+/=]*$/.test(base64)) throw new ChatError("rejected", "Badly encoded file.", 400);
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new ChatError("rejected", `"${name}" is empty.`, 400);
  if (bytes.length > MAX_FILE_BYTES) throw new ChatError("rejected", `"${name}" is over 15 MB.`, 400);
  const dir = path.join(dataDir, "chat-files", now.toISOString().slice(0, 10));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID().slice(0, 8)}-${clean}`);
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  return { path: file, name: clean, size: bytes.length };
}
