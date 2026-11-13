import { spawn } from "node:child_process";
import os from "node:os";

/**
 * Smart titles for the Chat: instead of the first words of the first message, a short title that
 * says what the conversation is about, written by a small model after the first answer and once more when the
 * conversation has gone on (the topic often shifts after a few turns). A title the person typed is never touched.
 *
 * Engine: Claude Code in print mode (`claude -p`), NO tools, the excerpt on stdin. Without `claude` on the server the
 * first words of the first message stay the title.
 */

export type TitleInput = { questions: string[]; answers: string[] };
export type TitleRunner = (system: string, prompt: string) => Promise<string>;

const CLAUDE = process.env.CHAT_TITLE_CLAUDE || "claude";
const MODEL = process.env.CHAT_TITLE_MODEL || "haiku";
const TIMEOUT_MS = 90_000;

/** User turns after which an automatic title is written again, with the whole picture. */
export const RETITLE_AT = 3;

export const TITLE_SYSTEM = [
  "You give a title to a conversation between a person and Hermes, their AI assistant.",
  "The title says exactly what it is about, like a clear email subject: 3 to 8 words, 60 characters at most, in the language of the conversation.",
  "Name the concrete thing (tool, file, video, person, number) rather than a vague word (Question, Request, Help).",
  "If the conversation changed topic, the title covers the main topic, or both briefly.",
  "Capital on the first word only (and on proper names), no quotes, no final period, no emoji.",
  "Answer ONLY with the title, on one line.",
].join("\n");

const clip = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
};

/** What the model reads: the person's messages (the first ones matter most) and the start of Hermes's answers. */
export function titlePrompt({ questions, answers }: TitleInput): string {
  const qs = questions.filter((q) => q.trim()).slice(0, 4);
  const lines = qs.map((q, i) => `Message ${i + 1} from the person: ${clip(q, i === 0 ? 1_500 : 700)}`);
  const first = answers.find((a) => a.trim());
  const last = answers.filter((a) => a.trim()).at(-1);
  if (first) lines.push(`Start of Hermes's first answer: ${clip(first, 800)}`);
  if (last && last !== first) lines.push(`Start of Hermes's last answer: ${clip(last, 500)}`);
  return `${lines.join("\n\n")}\n\nTitle of this conversation:`;
}

/** The model's line → a clean title, or null when it is unusable. */
export function cleanTitle(raw: string): string | null {
  let t = (raw.split("\n").find((l) => l.trim()) ?? "").trim();
  t = t.replace(/^(title|titre)\s*:\s*/i, "").replace(/^["'«»“”*#\s]+|["'«»“”*.。\s]+$/g, "").replace(/\s+/g, " ").trim();
  if (!t || t.length < 3) return null;
  if (t.length > 70) {
    const cut = t.slice(0, 70);
    const space = cut.lastIndexOf(" ");
    t = `${(space > 35 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?-]+$/, "")}…`;
  }
  return t;
}

/** `claude -p` without tools. Refuses to run under vitest. */
export const claudeTitleRunner: TitleRunner = (system, prompt) =>
  new Promise((resolve, reject) => {
    if (process.env.VITEST) return reject(new Error("no claude during tests"));
    const args = ["-p", "--output-format", "json", "--model", MODEL, "--tools", "", "--no-session-persistence", "--strict-mcp-config", "--append-system-prompt", system];
    const child = spawn(CLAUDE, args, { cwd: os.tmpdir(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("title: no answer in time")));
    }, TIMEOUT_MS);
    timer.unref();
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", () => {});
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) =>
      finish(() => {
        try {
          const env = JSON.parse(out) as { is_error?: boolean; result?: unknown };
          if (env.is_error || typeof env.result !== "string") return reject(new Error("title: empty answer"));
          resolve(env.result);
        } catch {
          reject(new Error(`title: claude failed (${code ?? "?"})`));
        }
      }),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
