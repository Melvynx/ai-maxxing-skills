import type { FixDraft, Priority } from "./model";

/** The rules every Infra task carries, whatever the problem: Hermes works on a live server. */
const RULES = [
  "Look first (read-only) and confirm the cause before changing anything.",
  "Fix it with the smallest safe change, then check again that it is fixed.",
  "Never open a port in the firewall, never turn off the sign-in gate or the tunnel, never print a password, a key or a token.",
  "If the fix could cut access to the server (SSH, firewall, network, reboot) or stop something people use, stop and ask the owner on chat first.",
  "When done, say in two or three short lines what was wrong and what you changed.",
];

/** Default text of a task sent to the Hermes board. The admin can edit it before sending. */
export function fixPrompt({ problem, detail = [], steps = [] }: { problem: string; detail?: string[]; steps?: string[] }): string {
  return [
    "The Infra page of the dashboard found a problem on this server. Please fix it.",
    "",
    `Problem: ${problem}`,
    ...(detail.length ? ["", "What the check saw:", ...detail.map((line) => `- ${line}`)] : []),
    ...(steps.length ? ["", "How to fix it:", ...steps.map((line, index) => `${index + 1}. ${line}`)] : []),
    "",
    "Rules:",
    ...RULES.map((line) => `- ${line}`),
  ].join("\n");
}

export function checkFix(key: string, title: string, problem: string, detail: string[] = [], steps: string[] = []): FixDraft {
  return { key: `health:${key}`, title: `Fix: ${title}`, prompt: fixPrompt({ problem, detail, steps }) };
}

/** A line of the daily audit's "Actions" list becomes a task with the same rules. */
export function auditFix(priority: Priority, text: string): FixDraft {
  const short = text.replace(/\s+/g, " ").trim();
  const slug = short.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return {
    key: `audit:${slug}`,
    title: `Fix: ${short.length > 70 ? `${short.slice(0, 69)}…` : short}`,
    prompt: fixPrompt({ problem: `${short} (${priority} in the daily infra audit)` }),
  };
}

/**
 * The daily audit cron's prompt. Fixed English headings so the Infra page can read every report; the agent only
 * looks, never changes anything (the page turns each action into a task an admin sends on purpose).
 */
export const AUDIT_PROMPT = `Audit this server (the machine you run on) and write a short report. Look only: do not change, restart, install or delete anything.

Check at least:
- Server: uptime and whether a restart is pending (/var/run/reboot-required), disk and inodes (df -h, df -i), memory and swap (free -m), load (uptime), failed services (systemctl --failed), out-of-memory kills and repeated errors in the last 24 hours (journalctl -p err --since "24 hours ago").
- Updates: pending security updates (apt list --upgradable), whether unattended-upgrades is on, whether Hermes has an update (hermes update --check).
- Security: SSH settings (sshd -T: passwordauthentication, permitrootlogin, port), the firewall (ufw status), recent failed SSH logins (journalctl -u ssh --since "24 hours ago" | grep -c "Failed").
- Exposure: every port listening outside localhost (ss -tlnp), and whether each one should be. The dashboard and Hermes are only meant to be reached through the Cloudflare tunnel and the sign-in gate; only SSH should be open.
- Hermes: the gateway, the chat platforms, crons that keep failing (hermes cron list).

Answer in English with exactly this format, nothing before it:

# Infra audit
Verdict: OK | ATTENTION | URGENT
Summary: one sentence a non-technical owner understands.

## Server
- one finding per line

## Security
- one finding per line

## Exposure
- one finding per line

## Not verified
- what you could not check, and why

## Actions
- **P0** what to do now, and why (only for something broken or dangerous)
- **P1** what to do this week, and why
- **P2** what can wait, and why

Use OK when nothing needs doing, ATTENTION when something should be done soon, URGENT when something is broken or exposed. Write "- None" under Actions when there is nothing to do. Keep every line short and plain.`;
