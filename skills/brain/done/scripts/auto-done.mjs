#!/usr/bin/env node
// Automatic /done and /dream for the brain, for Claude Code and Codex. Wired in:
//   <brain>/.claude/settings.json and <brain>/.codex/hooks.json
//     Stop         -> node .../auto-done.mjs stop   (remember this conversation, then sweep)
//     SessionStart -> node .../auto-done.mjs start  (sweep)
//   an optional hourly schedule (`auto-done.mjs schedule`) -> sweep, for tools without hooks
// A sweep picks one conversation that has been quiet for IDLE_MINUTES, has at least
// MIN_PROMPTS user messages since its last save and no /done after them, writes its
// text to .tmp/auto-done/<id>.md and starts a background agent (`claude -p` or
// `codex exec`) that runs the done skill in "automatic mode".
// When nothing is left to save, it may start a dream instead: the dream skill tidies the
// whole brain, at most once every DREAM_EVERY_HOURS and after DREAM_MIN_SAVES saves.
// One run at a time. A run that fails (usage limit, crash) is retried after RETRY_MINUTES,
// up to MAX_ATTEMPTS (usage limits do not count). Never blocks or fails the hook.
// Other modes: `dream-notes` (writes what was said since the last dream, for a manual
// /dream), `schedule` / `unschedule` (the hourly sweep).

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUND_MARK, findTranscripts, readConversation } from "./transcripts.mjs";

const IDLE_MINUTES = 20;
const MIN_PROMPTS = 2;
const GIVE_UP_HOURS = 24; // a too-short conversation is dropped after this
const MAX_CHARS = 250_000; // keep the end of very long conversations
const CLAUDE_MODEL = "sonnet"; // Codex runs with the user's own default model
const RETRY_MINUTES = 30;
const MAX_ATTEMPTS = 3;
const DREAM_EVERY_HOURS = 24;
const DREAM_MIN_SAVES = 5; // `done` commits since the last `dream` commit
const DREAM_FIRST_DAYS = 7; // the first dream reads this far back
const DREAM_MAX_CHARS = 150_000;

const now = Date.now();
const SCRIPT = fileURLToPath(import.meta.url);

function main() {
  const mode = process.argv[2];
  if (mode === "run") return run(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
  if (mode === "schedule" || mode === "unschedule") return schedule(mode, findBrain(process.argv[3] || process.cwd()));
  if (process.env.AUTO_DONE === "1") return; // hooks of our own background run

  let input = {};
  if (mode === "stop" || mode === "start") {
    try {
      input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
    } catch {}
  }
  const brain = findBrain(process.argv[3] || process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  if (!brain) return;

  const dir = path.join(brain, ".tmp", "auto-done");
  fs.mkdirSync(dir, { recursive: true });

  if (mode === "dream-notes") {
    const file = writeDreamNotes(brain, path.join(dir, "dream-notes.md"));
    console.log(path.relative(brain, file));
    return;
  }

  if (!lock(dir)) return;
  try {
    const statePath = path.join(dir, "state.json");
    const state = readJson(statePath) || { sessions: {} };
    state.scanSince ||= now; // conversations from before the first sweep are never saved

    if (mode === "stop" && input.session_id && input.transcript_path) {
      const s = state.sessions[input.session_id] || { doneUpto: 0 };
      s.transcript = input.transcript_path;
      s.cwd = input.cwd || "";
      s.tool = toolOf(input.transcript_path);
      s.lastStop = now;
      state.sessions[input.session_id] = s;
    }

    discover(brain, state);
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
    const common = git(start, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (path.basename(common) === ".git") root = path.dirname(common);
  } catch {}
  return fs.existsSync(path.join(root, ".agents", "skills", "done", "SKILL.md")) ? root : null;
}

// Adds the conversations found on disk (Claude Code and Codex), so a tool whose hooks
// are off, or a conversation that ended in another tool, is saved too.
function discover(brain, state) {
  const known = new Map(Object.entries(state.sessions).map(([id, s]) => [s.transcript, id]));
  for (const t of findTranscripts(brain, state.scanSince)) {
    const id = known.get(t.transcript) || t.id;
    const s = state.sessions[id] || { doneUpto: 0, transcript: t.transcript, cwd: t.cwd };
    if (s.background) continue;
    s.tool = t.tool;
    s.lastStop = Math.max(s.lastStop || 0, t.lastActive);
    state.sessions[id] = s;
  }
}

function sweep(brain, dir, state, currentId) {
  if (state.running) {
    const r = state.running;
    if (alive(r.pid) && now - r.started < 30 * 60_000) return;
    delete state.running;
    finished(dir, state, r);
  }

  const quiet = Object.entries(state.sessions)
    .filter(([id, s]) => id !== currentId && !s.background && now - s.lastStop >= IDLE_MINUTES * 60_000 && now >= (s.retryAt || 0))
    .sort((a, b) => a[1].lastStop - b[1].lastStop);

  for (const [id, s] of quiet) {
    if (!fs.existsSync(s.transcript)) {
      delete state.sessions[id];
      continue;
    }
    const lines = fs.readFileSync(s.transcript, "utf8").split("\n");
    const convo = readConversation(lines, s.doneUpto || 0, { id });
    if (convo.background) {
      s.background = true; // one of our own runs: never save it
      continue;
    }

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
    fs.writeFileSync(file, `# Conversation ${id}\n\nTool: ${s.tool || "claude"}. Last message: ${day}. Folder: ${s.cwd}\n\n${text}\n`);

    const prompt = `${BACKGROUND_MARK} Automatic mode of the done skill. Read .agents/skills/done/SKILL.md and follow it, including its "Automatic mode" section. The conversation to save is in ${path.relative(brain, file)}: only what was said since its last save. If git refuses to commit, write the commit message in ${path.relative(brain, path.join(dir, `${id}.commit`))} and stop: the script commits. Nobody is watching: ask nothing.`;
    const pid = launch(brain, dir, "done", id, prompt, s.tool);
    if (!pid) return;
    state.running = { kind: "done", pid, id, started: now, from: s.doneUpto || 0 };
    s.doneUpto = lines.length;
    return; // one at a time
  }

  // Nothing left to save: maybe dream. Never while another brain conversation is active.
  const busy = Object.entries(state.sessions).some(([id, s]) => id !== currentId && !s.background && now - s.lastStop < IDLE_MINUTES * 60_000);
  if (!busy && dreamDue(brain, state)) startDream(brain, dir, state);
}

// A background run ended: clean up after a success, plan a retry after a failure.
function finished(dir, state, r) {
  const result = readJson(path.join(dir, `${r.id}.result.json`));
  const files = ["md", "prompt.txt", "result.json", "commit"].map((ext) => path.join(dir, `${r.id}.${ext}`));
  const s = r.kind === "dream" ? (state.dream ||= {}) : state.sessions[r.id];
  if (result?.ok || !s || (s.attempts || 0) + 1 >= MAX_ATTEMPTS) {
    if (s) delete s.attempts;
    for (const f of files) fs.rmSync(f, { force: true });
    return;
  }
  if (r.kind === "done") s.doneUpto = r.from ?? 0; // failed: save the same part again later
  else delete s.lastRun; // failed dream: due again after the retry delay
  if (!result?.limited) s.attempts = (s.attempts || 0) + 1; // a usage limit is not the conversation's fault
  s.retryAt = now + RETRY_MINUTES * 60_000;
}

// Due when the dream skill is installed, DREAM_EVERY_HOURS have passed since the last
// dream (its git commit, or its last run when it changed nothing) and the brain got at
// least DREAM_MIN_SAVES saves since.
function dreamDue(brain, state) {
  if (!fs.existsSync(path.join(brain, ".agents", "skills", "dream", "SKILL.md"))) return false;
  const d = state.dream || {};
  if (now < (d.retryAt || 0)) return false;
  const last = lastDream(brain);
  if (now - Math.max(last.at, d.lastRun || 0) < DREAM_EVERY_HOURS * 3_600_000) return false;
  try {
    const range = last.hash ? [`${last.hash}..HEAD`] : ["HEAD"];
    return Number(git(brain, ["rev-list", "--count", "--grep=^done", ...range])) >= DREAM_MIN_SAVES;
  } catch {
    return false;
  }
}

function startDream(brain, dir, state) {
  const id = `dream-${new Date(now).toISOString().slice(0, 10)}`;
  const notes = writeDreamNotes(brain, path.join(dir, `${id}.md`));
  const since = lastDream(brain).at;
  const prompt = `${BACKGROUND_MARK} Automatic mode of the dream skill. Read .agents/skills/dream/SKILL.md and follow it, including its "Automatic mode" section. Last dream: ${since ? new Date(since).toISOString() : "never"}. What the user said since then, in every tool: ${path.relative(brain, notes)}. If git refuses to commit, write the commit message in ${path.relative(brain, path.join(dir, `${id}.commit`))} and stop: the script commits. Nobody is watching: ask nothing.`;
  const tools = Object.values(state.sessions).sort((a, b) => b.lastStop - a.lastStop);
  const pid = launch(brain, dir, "dream", id, prompt, tools[0]?.tool);
  if (!pid) return;
  state.running = { kind: "dream", pid, id, started: now };
  (state.dream ||= {}).lastRun = now;
}

function lastDream(brain) {
  try {
    const [hash, at] = git(brain, ["log", "-1", "--grep=^dream", "--format=%H %ct"]).split(" ");
    return { hash: hash || "", at: Number(at || 0) * 1000 };
  } catch {
    return { hash: "", at: 0 };
  }
}

// What the user said in the brain since the last dream, in every tool, for the dream skill.
function writeDreamNotes(brain, file) {
  const since = lastDream(brain).at || now - DREAM_FIRST_DAYS * 86_400_000;
  const parts = [];
  for (const t of findTranscripts(brain, since).sort((a, b) => a.lastActive - b.lastActive)) {
    let lines;
    try {
      lines = fs.readFileSync(t.transcript, "utf8").split("\n");
    } catch {
      continue;
    }
    const convo = readConversation(lines, 0, { id: t.id, since });
    if (convo.background || !convo.userTexts.length) continue;
    const said = convo.userTexts.map((x) => `- ${x.length > 1500 ? x.slice(0, 1500) + " [...]" : x}`.replace(/\n/g, "\n  "));
    parts.push(`## ${new Date(t.lastActive).toISOString().slice(0, 16).replace("T", " ")} (${t.tool}, ${t.id})\n\n${said.join("\n")}`);
  }
  let text = parts.join("\n\n") || "(no conversation found on disk)";
  if (text.length > DREAM_MAX_CHARS) text = "[... start cut ...]\n\n" + text.slice(-DREAM_MAX_CHARS);
  const title = `# What the user said since ${new Date(since).toISOString().slice(0, 10)}\n\nOnly the user's messages, oldest conversation first. The saves (\`done\` commits) hold the rest.\n\n`;
  fs.writeFileSync(file, title + text + "\n");
  return file;
}

// The tool that wrote a transcript, from its path.
function toolOf(transcript) {
  return /[\\/]\.codex[\\/]/.test(transcript || "") ? "codex" : "claude";
}

// The background agent: BRAIN_AGENT if set, else the tool the conversation came from,
// else whichever is installed.
function pickAgent(tool) {
  const order = [process.env.BRAIN_AGENT, tool, "claude", "codex"].filter(Boolean);
  for (const name of order) {
    const bin = findBin(name);
    if (bin) return { name, bin };
  }
  return null;
}

// Starts `auto-done.mjs run` in the background; it waits for the agent and writes the result.
function launch(brain, dir, kind, id, prompt, tool) {
  const agent = pickAgent(tool);
  if (!agent) return 0;
  fs.writeFileSync(path.join(dir, `${id}.prompt.txt`), prompt);
  for (const ext of ["result.json", "commit"]) fs.rmSync(path.join(dir, `${id}.${ext}`), { force: true });
  const child = spawn(process.execPath, [SCRIPT, "run", kind, id, brain, agent.name], {
    cwd: brain,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid || 0;
}

function run(kind, id, brain, agentName) {
  const dir = path.join(brain, ".tmp", "auto-done");
  const logPath = path.join(dir, `${id}.log`);
  const log = fs.openSync(logPath, "w");
  const bin = findBin(agentName);
  // Claude may commit itself; Codex runs sandboxed (no .git, no network), so the script commits.
  const args =
    agentName === "codex"
      ? ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "workspace-write", "-C", brain, "-"]
      : [
          "-p",
          "--model", CLAUDE_MODEL,
          "--no-session-persistence",
          "--permission-mode", "acceptEdits",
          "--allowedTools", "Read,Edit,Write,Glob,Grep,Skill,Bash(git:*),Bash(ls:*),Bash(mkdir:*),Bash(trash:*),Bash(date:*)",
        ];
  const child = spawn(bin, args, {
    cwd: brain,
    stdio: [fs.openSync(path.join(dir, `${id}.prompt.txt`), "r"), log, log], // prompt on stdin: no quoting issues
    env: { ...process.env, AUTO_DONE: "1" },
    shell: bin.endsWith(".cmd"),
    windowsHide: true,
  });
  const finish = (code) => {
    const out = fs.readFileSync(logPath, "utf8");
    const limited = /hit your .*limit|usage limit|rate limit/i.test(out);
    const ok = code === 0 && !limited;
    if (ok) commitLeftovers(brain, dir, kind, id);
    fs.writeFileSync(path.join(dir, `${id}.result.json`), JSON.stringify({ ok, limited, code, agent: agentName, at: Date.now() }));
  };
  child.on("error", () => finish(-1));
  child.on("close", finish);
  return "wait"; // keep this process alive until the agent is done
}

// Commits what the agent changed but could not commit itself, then pushes.
function commitLeftovers(brain, dir, kind, id) {
  try {
    if (git(brain, ["status", "--porcelain"])) {
      let message = "";
      try {
        message = fs.readFileSync(path.join(dir, `${id}.commit`), "utf8").trim();
      } catch {}
      if (kind === "dream" && !message.startsWith("dream")) message = `dream: ${message || "brain tidied"}`;
      if (kind === "done" && !message.startsWith("done")) message = `done (auto): ${message || "conversation saved"}`;
      git(brain, ["add", "-A"]);
      git(brain, ["commit", "-q", "-m", message]);
    }
    if (git(brain, ["remote"])) git(brain, ["push", "-q"], 60_000);
  } catch {}
}

// Hourly sweep without hooks: launchd (macOS), cron (Linux), Task Scheduler (Windows).
function schedule(mode, brain) {
  if (!brain) return console.log("Not a brain: run this inside the brain folder.");
  const name = `brain-auto-done-${path.basename(brain).replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const cmd = [process.execPath, SCRIPT, "sweep", brain];
  const on = mode === "schedule";

  if (process.platform === "darwin") {
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", `${name}.plist`);
    const domain = `gui/${process.getuid()}`;
    try {
      execFileSync("launchctl", ["bootout", domain, plist], { stdio: "ignore" });
    } catch {}
    if (!on) {
      fs.rmSync(plist, { force: true });
      return console.log("Hourly sweep removed.");
    }
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${name}</string>
  <key>ProgramArguments</key><array>${cmd.map((a) => `<string>${esc(a)}</string>`).join("")}</array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(process.env.PATH || "")}</string></dict>
  <key>WorkingDirectory</key><string>${esc(brain)}</string>
  <key>StartInterval</key><integer>3600</integer>
</dict>
</plist>
`;
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, xml);
    execFileSync("launchctl", ["bootstrap", domain, plist]);
    return console.log(`Hourly sweep on: ${plist}`);
  }

  if (process.platform === "win32") {
    if (!on) {
      try {
        execFileSync("schtasks", ["/Delete", "/F", "/TN", name], { stdio: "ignore" });
      } catch {}
      return console.log("Hourly sweep removed.");
    }
    execFileSync("schtasks", ["/Create", "/F", "/SC", "HOURLY", "/TN", name, "/TR", cmd.map((a) => `"${a}"`).join(" ")]);
    return console.log(`Hourly sweep on: task ${name}`);
  }

  let tab = "";
  try {
    tab = execFileSync("crontab", ["-l"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {}
  const lines = tab.split("\n").filter((l) => l.trim() && !l.includes(`# ${name}`));
  if (on) lines.push(`0 * * * * PATH="${process.env.PATH}" ${cmd.map((a) => `"${a}"`).join(" ")} >/dev/null 2>&1 # ${name}`);
  execFileSync("crontab", ["-"], { input: lines.join("\n") + "\n" });
  console.log(on ? "Hourly sweep on (crontab)." : "Hourly sweep removed.");
}

function findBin(name) {
  if (!["claude", "codex"].includes(name)) return null;
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`] : [name];
  const dirs = [...(process.env.PATH || "").split(path.delimiter), path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const d of dirs) for (const n of names) if (d && fs.existsSync(path.join(d, n))) return path.join(d, n);
  return null;
}

function git(cwd, args, timeout = 10_000) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout }).trim();
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
} catch (e) {
  if (!["stop", "start", "sweep", "run"].includes(process.argv[2])) console.error(e.message); // hooks stay silent
}
if (result !== "wait") process.exit(0);
