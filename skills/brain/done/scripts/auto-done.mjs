#!/usr/bin/env node
// Automatic /done for the brain. Wired in <brain>/.claude/settings.json:
//   Stop         -> node .../auto-done.mjs stop   (remember this conversation, then sweep)
//   SessionStart -> node .../auto-done.mjs start  (sweep)
// A sweep picks one conversation that has been quiet for IDLE_MINUTES, has at least
// MIN_PROMPTS user messages since its last save and no /done after them, writes its
// text to .tmp/auto-done/<id>.md and starts a background `claude -p` that runs the
// done skill in "automatic mode". One run at a time. A run that fails (usage limit,
// crash) is retried after RETRY_MINUTES, up to MAX_ATTEMPTS (usage limits do not count). Never blocks or fails the hook.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IDLE_MINUTES = 20;
const MIN_PROMPTS = 2;
const GIVE_UP_HOURS = 24; // a too-short conversation is dropped after this
const MAX_CHARS = 250_000; // keep the end of very long conversations
const MODEL = "sonnet";
const RETRY_MINUTES = 30;
const MAX_ATTEMPTS = 3;

const now = Date.now();

function main() {
  const mode = process.argv[2];
  if (mode === "run") return run(process.argv[3], process.argv[4]);
  if (process.env.AUTO_DONE === "1") return; // hooks of our own background run
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {}

  const brain = findBrain(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  if (!brain) return;

  const dir = path.join(brain, ".tmp", "auto-done");
  fs.mkdirSync(dir, { recursive: true });
  if (!lock(dir)) return;
  try {
    const statePath = path.join(dir, "state.json");
    const state = readJson(statePath) || { sessions: {} };

    if (mode === "stop" && input.session_id && input.transcript_path) {
      const s = state.sessions[input.session_id] || { doneUpto: 0 };
      s.transcript = input.transcript_path;
      s.cwd = input.cwd || "";
      s.lastStop = now;
      state.sessions[input.session_id] = s;
    }

    sweep(brain, dir, state, input.session_id);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } finally {
    unlock(dir);
  }
}

// The brain is the main checkout (not a worktree) and must hold the done skill.
function findBrain(start) {
  let root = start;
  try {
    const common = execFileSync("git", ["-C", start, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (path.basename(common) === ".git") root = path.dirname(common);
  } catch {}
  return fs.existsSync(path.join(root, ".agents", "skills", "done", "SKILL.md")) ? root : null;
}

function sweep(brain, dir, state, currentId) {
  if (state.running) {
    const r = state.running;
    if (alive(r.pid) && now - r.started < 30 * 60_000) return;
    delete state.running;
    const result = readJson(path.join(dir, `${r.id}.result.json`));
    const s = state.sessions[r.id];
    const files = ["md", "prompt.txt", "result.json"].map((ext) => path.join(dir, `${r.id}.${ext}`));
    if (result?.ok || !s || (s.attempts || 0) + 1 >= MAX_ATTEMPTS) {
      if (s) delete s.attempts;
      for (const f of files) fs.rmSync(f, { force: true });
    } else {
      s.doneUpto = r.from ?? 0; // failed: save the same part again later
      if (!result?.limited) s.attempts = (s.attempts || 0) + 1; // a usage limit is not the conversation's fault
      s.retryAt = now + RETRY_MINUTES * 60_000;
    }
  }

  const quiet = Object.entries(state.sessions)
    .filter(([id, s]) => id !== currentId && now - s.lastStop >= IDLE_MINUTES * 60_000 && now >= (s.retryAt || 0))
    .sort((a, b) => a[1].lastStop - b[1].lastStop);

  for (const [id, s] of quiet) {
    if (!fs.existsSync(s.transcript)) {
      delete state.sessions[id];
      continue;
    }
    const lines = fs.readFileSync(s.transcript, "utf8").split("\n");
    const convo = readConversation(lines, s.doneUpto || 0, id);

    if (convo.prompts < MIN_PROMPTS) {
      if (now - s.lastStop >= GIVE_UP_HOURS * 3_600_000) {
        if (convo.prompts === 0 && s.doneUpto >= lines.length) delete state.sessions[id];
        else s.doneUpto = lines.length;
      }
      continue;
    }

    let text = convo.messages.join("\n\n");
    if (text.length > MAX_CHARS) text = "[... start cut ...]\n\n" + text.slice(-MAX_CHARS);
    const day = new Date(s.lastStop).toISOString().slice(0, 10);
    const file = path.join(dir, `${id}.md`);
    fs.writeFileSync(file, `# Conversation ${id}\n\nLast message: ${day}. Folder: ${s.cwd}\n\n${text}\n`);

    const pid = launch(brain, dir, id, path.relative(brain, file));
    if (!pid) return;
    state.running = { pid, id, started: now, from: s.doneUpto || 0 };
    s.doneUpto = lines.length;
    return; // one at a time
  }
}

// Text of the conversation since line `from`, only its own lines (a forked conversation
// starts with a copy of its parent's), restarted after every /done.
function readConversation(lines, from, id) {
  let messages = [];
  let prompts = 0;
  for (let i = from; i < lines.length; i++) {
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (o.isSidechain || (o.sessionId && o.sessionId !== id)) continue;
    const content = o.message?.content;

    if (o.type === "user") {
      const raw = typeof content === "string" ? content : Array.isArray(content) ? content.filter((c) => c.type === "text").map((c) => c.text).join("\n") : "";
      // a real /done line starts with the command tags; a summary may only quote them
      if (/^\s*<command-(name|message)>/.test(raw) && raw.includes("<command-name>/done</command-name>")) {
        messages = [];
        prompts = 0;
        continue;
      }
      if (o.isMeta) continue;
      const text = clean(raw);
      if (!text) continue;
      messages.push(`## User\n${text}`);
      if (!text.startsWith("This session is being continued from a previous conversation")) prompts++;
    }

    if (o.type === "assistant" && Array.isArray(content)) {
      for (const c of content) {
        if (c.type === "tool_use" && c.name === "Skill" && /(^|:)done$/.test(c.input?.skill || "")) {
          messages = [];
          prompts = 0;
        } else if (c.type === "text" && c.text.trim()) {
          messages.push(`## Claude\n${c.text.trim()}`);
        } else if (c.type === "tool_use") {
          const what = c.input?.file_path || c.input?.description || c.input?.url || "";
          if (what) messages.push(`(${c.name}: ${String(what).slice(0, 200)})`);
        }
      }
    }
  }
  return { messages, prompts };
}

function clean(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<local-command-std(out|err)>[\s\S]*?<\/local-command-std(out|err)>/g, "")
    .trim();
}

// Starts `auto-done.mjs run` in the background; it waits for Claude and writes the result.
function launch(brain, dir, id, relFile) {
  if (!findClaude()) return 0;
  const prompt = `Automatic mode of the done skill. Read .agents/skills/done/SKILL.md and follow it, including its "Automatic mode" section. The conversation to save is in ${relFile}: only what was said since its last save. Nobody is watching: ask nothing.`;
  fs.writeFileSync(path.join(dir, `${id}.prompt.txt`), prompt);
  fs.rmSync(path.join(dir, `${id}.result.json`), { force: true });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run", id, brain], {
    cwd: brain,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid || 0;
}

function run(id, brain) {
  const dir = path.join(brain, ".tmp", "auto-done");
  const logPath = path.join(dir, `${id}.log`);
  const log = fs.openSync(logPath, "w");
  const claude = findClaude();
  const child = spawn(
    claude,
    [
      "-p",
      "--model", MODEL,
      "--permission-mode", "acceptEdits",
      "--allowedTools", "Read,Edit,Write,Glob,Grep,Skill,Bash(git:*),Bash(ls:*),Bash(mkdir:*),Bash(trash:*),Bash(date:*)",
    ],
    {
      cwd: brain,
      stdio: [fs.openSync(path.join(dir, `${id}.prompt.txt`), "r"), log, log], // prompt on stdin: no quoting issues
      env: { ...process.env, AUTO_DONE: "1" },
      shell: claude.endsWith(".cmd"),
      windowsHide: true,
    },
  );
  const finish = (code) => {
    const out = fs.readFileSync(logPath, "utf8");
    const limited = /hit your .*limit|usage limit|rate limit/i.test(out);
    fs.writeFileSync(path.join(dir, `${id}.result.json`), JSON.stringify({ ok: code === 0 && !limited, limited, code, at: Date.now() }));
  };
  child.on("error", () => finish(-1));
  child.on("close", finish);
  return "wait"; // keep this process alive until Claude is done
}

function findClaude() {
  const names = process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  const dirs = [...(process.env.PATH || "").split(path.delimiter), path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const d of dirs) for (const n of names) if (d && fs.existsSync(path.join(d, n))) return path.join(d, n);
  return null;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lock(dir) {
  const l = path.join(dir, "lock");
  try {
    fs.mkdirSync(l);
    return true;
  } catch {
    try {
      if (now - fs.statSync(l).mtimeMs > 60_000) {
        fs.rmdirSync(l);
        fs.mkdirSync(l);
        return true;
      }
    } catch {}
    return false;
  }
}

function unlock(dir) {
  try {
    fs.rmdirSync(path.join(dir, "lock"));
  } catch {}
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

let result;
try {
  result = main();
} catch {}
if (result !== "wait") process.exit(0);
