// Reads the brain's conversations from every tool that keeps them on disk:
//   Claude Code -> ~/.claude/projects/<brain path with dashes>/<id>.jsonl
//   Codex       -> ~/.codex/sessions/YYYY/MM/DD/rollout-<date>-<id>.jsonl
// findTranscripts() lists the ones that happened in the brain, readConversation() turns
// one into plain "## User" / "## Agent" text. Used by auto-done.mjs (saves and dreams).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Every background run (save or dream) starts its prompt with this, so its own
// transcript is never saved or dreamed about. Older runs started with OLD_BACKGROUND.
export const BACKGROUND_MARK = "[brain background run]";
const OLD_BACKGROUND = "Automatic mode of the done skill.";

const MAX_SCAN_DAYS = 14;

// Conversations of the brain changed after `sinceMs`: [{ id, tool, transcript, cwd, lastActive }].
export function findTranscripts(brain, sinceMs) {
  return [...claudeTranscripts(brain, sinceMs), ...codexTranscripts(brain, sinceMs)];
}

function claudeTranscripts(brain, sinceMs) {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const dir = path.join(home, "projects", brain.replace(/[^a-zA-Z0-9]/g, "-"));
  const found = [];
  for (const name of list(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    const mtime = mtimeOf(file);
    if (mtime > sinceMs) found.push({ id: name.slice(0, -6), tool: "claude", transcript: file, cwd: brain, lastActive: mtime });
  }
  return found;
}

// Codex keeps one folder per day: only the days since `sinceMs` are opened, and only
// the first bytes of each file are read to find the folder it ran in.
function codexTranscripts(brain, sinceMs) {
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
  const found = [];
  const start = Math.max(sinceMs, Date.now() - MAX_SCAN_DAYS * 86_400_000) - 86_400_000; // one day of margin for time zones
  for (let day = start; day <= Date.now() + 86_400_000; day += 86_400_000) {
    const d = new Date(day);
    const dir = path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
    for (const name of list(dir)) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const file = path.join(dir, name);
      const mtime = mtimeOf(file);
      if (mtime <= sinceMs || found.some((f) => f.transcript === file)) continue;
      const head = readStart(file, 16_384);
      const cwd = jsonString(head, "cwd");
      if (!cwd || !isInside(cwd, brain)) continue;
      const id = jsonString(head, "id") || name.match(/([0-9a-f-]{36})\.jsonl$/)?.[1] || name;
      found.push({ id, tool: "codex", transcript: file, cwd, lastActive: mtime });
    }
  }
  return found;
}

// Text of a conversation from line `from`, restarted after every /done.
// Options: `id` drops lines of another conversation (a forked Claude conversation starts
// with a copy of its parent's), `since` drops lines older than that time (ms).
// Returns { messages, userTexts, prompts, background }.
export function readConversation(lines, from = 0, { id, since = 0 } = {}) {
  const codex = lines.slice(0, 5).some((l) => l.includes('"type":"session_meta"'));
  const convo = { messages: [], userTexts: [], prompts: 0, background: false };
  const restart = () => {
    convo.messages = [];
    convo.userTexts = [];
    convo.prompts = 0;
  };
  const user = (text) => {
    if (text.includes(BACKGROUND_MARK) || text.startsWith(OLD_BACKGROUND)) convo.background = true;
    if (convo.userTexts.at(-1) === text) return; // Codex may log the same message twice
    convo.messages.push(`## User\n${text}`);
    convo.userTexts.push(text);
    if (!text.startsWith("This session is being continued from a previous conversation")) convo.prompts++;
  };

  for (let i = from; i < lines.length; i++) {
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (since && o.timestamp && Date.parse(o.timestamp) < since) continue;
    if (codex) readCodexLine(o, convo, user, restart);
    else readClaudeLine(o, id, convo, user, restart);
  }
  return convo;
}

function readClaudeLine(o, id, convo, user, restart) {
  if (o.isSidechain || (id && o.sessionId && o.sessionId !== id)) return;
  const content = o.message?.content;

  if (o.type === "user") {
    const raw = typeof content === "string" ? content : Array.isArray(content) ? content.filter((c) => c.type === "text").map((c) => c.text).join("\n") : "";
    // a real /done line starts with the command tags; a summary may only quote them
    if (/^\s*<command-(name|message)>/.test(raw) && raw.includes("<command-name>/done</command-name>")) return restart();
    if (o.isMeta) return;
    const text = clean(raw);
    if (text) user(text);
  }

  if (o.type === "assistant" && Array.isArray(content)) {
    for (const c of content) {
      if (c.type === "tool_use" && c.name === "Skill" && /(^|:)done$/.test(c.input?.skill || "")) {
        restart();
      } else if (c.type === "text" && c.text.trim()) {
        convo.messages.push(`## Agent\n${c.text.trim()}`);
      } else if (c.type === "tool_use") {
        const what = c.input?.file_path || c.input?.description || c.input?.url || "";
        if (what) convo.messages.push(`(${c.name}: ${String(what).slice(0, 200)})`);
      }
    }
  }
}

// Codex writes each message as an `item_completed` event (older versions: `user_message`
// and `agent_message`). The instructions it injects (AGENTS.md, environment) are other
// line types, so they are skipped.
function readCodexLine(o, convo, user, restart) {
  if (o.type !== "event_msg") return;
  const p = o.payload || {};
  const item = p.type === "item_completed" ? p.item || {} : {};
  const textOf = (content) => (Array.isArray(content) ? content.filter((c) => /^text$/i.test(c.type)).map((c) => c.text).join("\n") : "");

  if (item.type === "UserMessage" || p.type === "user_message") {
    const text = clean(item.type ? textOf(item.content) : p.message || "");
    if (/^[/$]done\b/i.test(text)) return restart();
    if (text) user(text);
  }
  if (item.type === "AgentMessage" || p.type === "agent_message") {
    const text = (item.type ? textOf(item.content) : p.message || "").trim();
    if (text) convo.messages.push(`## Agent\n${text}`);
  }
}

function clean(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<local-command-std(out|err)>[\s\S]*?<\/local-command-std(out|err)>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .trim();
}

export function isInside(dir, root) {
  const rel = path.relative(root, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function list(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function readStart(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    return buf.toString("utf8", 0, fs.readSync(fd, buf, 0, bytes, 0));
  } finally {
    fs.closeSync(fd);
  }
}

// First `"key":"value"` in a piece of JSON text, without parsing the whole line.
function jsonString(text, key) {
  const m = text.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return "";
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return "";
  }
}

function pad(n) {
  return String(n).padStart(2, "0");
}
