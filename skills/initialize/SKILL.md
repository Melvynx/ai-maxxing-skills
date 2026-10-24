---
name: initialize
description: Install the base skills every agent should have, globally and in one command - the AIBlueprint base (skills, statusline, security hooks), /show-me, /grill-me, /wait-what (Matt Pocock) and /connect-tool - for Claude Code and Codex. Use when the user types /initialize, sets up a new computer, says "installe les skills de base" or before setup-brain.
---

Give every agent on this computer the base skills, in every folder. Do it yourself and talk to the user in their language, short, no jargon (never say "symlink" or "npx" to them).

If you got this skill from a link instead of a local folder, install nothing else from the repo: the one command below downloads what it needs.

1. Check Node: if `npx --version` fails, run the `setup-node` skill first (from `https://raw.githubusercontent.com/Melvynx/ai-maxxing-skills/main/skills/setup-node/SKILL.md` when it is not installed).
2. Run the one command, in the background when your tool allows it (2 to 5 minutes):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/Melvynx/ai-maxxing-skills/main/skills/initialize/scripts/initialize.sh | bash
   ```
   It installs, for Claude Code and Codex:
   - the AIBlueprint base (`npx aiblueprint-cli@latest agents setup --skip`): its skills (apex, skill-manager...), agents, the statusline, the security hooks that block dangerous commands, and the `cc` / `cx` shortcuts in the terminal;
   - `/show-me` (explains anything with a small diagram or visual), `/grill-me` (sharpens an idea with questions before building) and `/connect-tool` (connects any tool like Notion or Stripe) from this kit;
   - `/wait-what` from Matt Pocock (`mattpocock/skills`): explains what the agent is doing right now, in plain words.
   On Windows without bash, run the three `npx` lines of [scripts/initialize.sh](scripts/initialize.sh) one by one in PowerShell.
3. Every skill lands once in `~/.agents/skills/` (the single source, Codex reads it there), and `~/.claude/skills/` only links to it. The script ends with an `ok` or `MISS` line per skill: fix a `FAIL` or `MISS` by rerunning its line and reading the error, never by copying files by hand into `~/.claude/skills`.
4. Tell the user in 3 lines what is installed, that a new session shows `/show-me`, `/grill-me`, `/wait-what` and `/connect-tool`, and that running `/initialize` again updates them.
