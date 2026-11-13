import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

/**
 * The Claude accounts Hermes can answer with, in the order it tries them (the first one is the one in use).
 * On the server, `hermes-accounts` (turned on by `hermes-setup accounts`) checks them every 15 minutes, puts the
 * account with the best delta first and writes what it saw in this file. No secret in it.
 */
export const claudeAccountsFile = (hermesHome: string) => path.join(hermesHome, "cache", "claude-pool-priority.json");

export interface ClaudeAccount {
  id: string;
  /** The name of the account in Hermes (`hermes auth list`). */
  label: string;
  /** The Claude login behind it; null when Anthropic did not say. */
  email: string | null;
  /** % of the weekly quota used. */
  used: number;
  /** % of the week already gone. */
  elapsed: number;
  /** elapsed - used: the higher, the more quota left for the time left. */
  delta: number;
  /** A quota window is used up: Hermes moves on to the next account. */
  full: boolean;
  /** When its week starts again (ms); null when unknown. */
  resetsAt: number | null;
}

export interface ClaudeAccounts {
  /** When the accounts were last checked (ms). */
  checkedAt: number;
  accounts: ClaudeAccount[];
}

const File = z.object({
  checked_at: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  accounts: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      email: z.string().nullish(),
      used: z.number(),
      elapsed: z.number(),
      delta: z.number(),
      full: z.boolean().default(false),
      resets_at: z.string().nullish(),
    }),
  ),
});

export function toClaudeAccounts(raw: unknown): ClaudeAccounts | null {
  const file = File.safeParse(raw);
  if (!file.success || !file.data.accounts.length) return null;
  return {
    checkedAt: Date.parse(file.data.checked_at),
    accounts: file.data.accounts.map((a) => ({
      id: a.id,
      label: a.label,
      email: a.email ?? null,
      used: a.used,
      elapsed: a.elapsed,
      delta: a.delta,
      full: a.full,
      resetsAt: (a.resets_at && Date.parse(a.resets_at)) || null,
    })),
  };
}

/** Null when the file is missing or unreadable (the watch is not on yet): the page then shows no accounts. */
export async function readClaudeAccounts(file: string): Promise<ClaudeAccounts | null> {
  try {
    return toClaudeAccounts(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return null;
  }
}
