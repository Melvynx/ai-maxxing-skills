import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";

export type RunResult = { code: number; stdout: string; stderr: string };

/**
 * Everything Infra asks of the machine, in one place: the checks and the fixes only go through this, so tests hand
 * them a fake machine and never touch the real one. Nothing here throws: a missing command or file gives an answer
 * the checks read as "could not check".
 */
export interface System {
  /** Runs a command without a shell (arguments are never parsed), with a timeout and an optional stdin. */
  run(command: string, args: string[], options?: { timeoutMs?: number; input?: string }): Promise<RunResult>;
  /** File contents, or null when it does not exist or cannot be read. */
  read(file: string): Promise<string | null>;
  /** Names of the files of a folder (empty when it does not exist). */
  list(dir: string): Promise<string[]>;
  exists(file: string): Promise<boolean>;
  /** Space of the disk holding `dir`, in bytes. */
  disk(dir: string): Promise<{ total: number; free: number } | null>;
  cpus(): number;
  now(): number;
}

const MAX_OUTPUT = 2_000_000;

export const realSystem: System = {
  run(command, args, { timeoutMs = 15_000, input } = {}) {
    return new Promise((resolve) => {
      const child = execFile(command, args, { timeout: timeoutMs, maxBuffer: MAX_OUTPUT, env: { ...process.env, LC_ALL: "C" } }, (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 127) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) || (error && code === 127 ? error.message : "") });
      });
      if (input !== undefined) child.stdin?.end(input);
      else child.stdin?.end();
    });
  },
  read: (file) => fs.readFile(file, "utf8").catch(() => null),
  list: (dir) => fs.readdir(dir).catch(() => []),
  exists: (file) =>
    fs.access(file).then(
      () => true,
      () => false,
    ),
  async disk(dir) {
    try {
      const stats = await fs.statfs(dir);
      return { total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize };
    } catch {
      return null;
    }
  },
  cpus: () => Math.max(1, os.availableParallelism()),
  now: () => Date.now(),
};
