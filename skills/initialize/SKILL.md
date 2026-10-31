---
name: initialize
description: Install the base skills every agent should have, globally and in one command - the AIBlueprint base (skills, statusline, security hooks), /show-me, /grill-me, /wait-what (Matt Pocock), /connect-tool and /use-style - for Claude Code and Codex, then asks the user which visual style they like and makes it the default for every file the agent creates. Use when the user types /initialize, sets up a new computer, says "installe les skills de base" or before setup-brain.
---

Give every agent on this computer the base skills, in every folder. Do it yourself and talk to the user in their language, short, no jargon (never say "symlink" or "npx" to them).

If you got this skill from a link instead of a local folder, install nothing else from the repo: the one command below downloads what it needs.

1. Check Node: if `npx --version` fails, run the `setup-node` skill first (from `https://raw.githubusercontent.com/Melvynx/ai-maxxing-skills/main/skills/setup-node/SKILL.md` when it is not installed).
2. Run the one command, in the background when your tool allows it (2 to 5 minutes):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/Melvynx/ai-maxxing-skills/main/skills/initialize/scripts/initialize.sh | bash
   ```
   It installs, for Claude Code and Codex:
   - the AIBlueprint base (`npx aiblueprint-cli@latest agents setup --skip`): its skills (apex, plan...), agents, the statusline, the security hooks that block dangerous commands, and the `cc` / `cx` shortcuts in the terminal;
   - `skill-manager` (installs, updates or removes a skill from a name or a link, and creates or fixes their own skills; it replaces the AIBlueprint one), `/show-me` (explains anything with a small diagram or visual), `/grill-me` (sharpens an idea with questions before building), `/connect-tool` (connects any tool like Notion or Stripe) and `/use-style` (gives pages, apps and documents a named visual style like Vercel, Stripe or Linear) from this kit;
   - `/wait-what` from Matt Pocock (`mattpocock/skills`): explains what the agent is doing right now, in plain words.
   On Windows without bash, run the three `npx` lines of [scripts/initialize.sh](scripts/initialize.sh) one by one in PowerShell.
3. Every skill lands once in `~/.agents/skills/` (the single source, Codex reads it there), and `~/.claude/skills/` only links to it. The script ends with an `ok` or `MISS` line per skill: fix a `FAIL` or `MISS` by rerunning its line and reading the error, never by copying files by hand into `~/.claude/skills`.
4. **Style.** Open the style gallery so the user sees every style side by side: `~/.agents/skills/use-style/examples/gallery.html` (`open` on Mac, `xdg-open` on Linux, `start` on Windows). Ask one question: which style speaks to them most, the one they would like for their pages, apps and documents. Give the names with their one-line description from the gallery, and say they can click a card to see it full size. When they hesitate, recommend `vercel`. When `~/.agents/AGENTS.md` already has a `## Style` section, show its style and ask only whether to keep it.
5. **Global rule.** Write their choice in the global rules, `~/.agents/AGENTS.md` (create it when missing; `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` link to it once `setup-brain` ran). When it already has a `## Style` section, replace that section up to the next `## ` heading and keep every other line; otherwise add it at the end, after one blank line:
   ```markdown
   ## Style

   When you create a file the user will look at (a page, an app screen, a dashboard, an HTML report, a document, a visual), use the `use-style` skill with the `<chosen style>` style, unless the user asks for another one or the project already has its own design.
   ```
   When `~/.claude/CLAUDE.md` is a separate file (not a link to `~/.agents/AGENTS.md`), write the same section there too.
6. Tell the user in 3 lines what is installed, that a new session shows `/show-me`, `/grill-me`, `/wait-what`, `/connect-tool` and `/use-style`, which style is now their default (they can change it any time by asking), and that running `/initialize` again updates the skills.
