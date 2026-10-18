---
name: setup-cli-skills
description: Find the official CLI of a tool (Notion, Stripe, GitHub, Supabase...), install it, connect it, and create a global skill so every agent knows how to use it. Use when the user wants their agent to use a tool, says "setup notion", "install the X CLI", or "make a skill for X".
argument-hint: "<tool name, e.g. notion>"
---

# Setup CLI skills

The user names a tool. You find its **official CLI**, install it, connect it to their account, then write a skill so every future session (Claude Code, Codex, any agent) knows how to use it, from any folder.

Talk to the user in their language. Short, simple, one question at a time. No jargon in what you say to them (no "symlink", "frontmatter", "PATH", "env var" without explaining it in plain words).

## Step 1: Understand which tool

1. Read the argument. Fix obvious typos ("mtoin" or "notoin" means Notion) and confirm in one line: "You mean Notion, right?". If nothing was given, ask which tool.
2. Skill name: `<tool>-cli` in lowercase with dashes (`notion-cli`, `stripe-cli`, `google-workspace-cli`).
3. If `~/.agents/skills/<tool>-cli/` or `~/.claude/skills/<tool>-cli/` already exists, read it and tell the user what is there. Ask whether to update it or stop. Never overwrite silently.

## Step 2: Find the official CLI

1. Check if it is already installed: try the likely command names with `command -v` (for example `ntn` and `notion` for Notion, `stripe`, `gh`, `supabase`, `vercel`).
2. Search the web for "<tool> official CLI" and open the vendor's own docs. Keep only a CLI published by the vendor itself (their domain, their GitHub organisation, their docs). Note: the exact command name, the install command for this OS, the login command, and the docs URL.
3. If there is no official CLI, say so plainly. Show at most 2 alternatives (a well-maintained community CLI with its stars and last release date, or the vendor's API called with `curl`) and let the user pick. Never install an unknown package without their yes.

## Step 3: Install

1. Use the install method from the official docs, in this order of preference: Homebrew on macOS (`brew install ...`), the vendor's documented `npm i -g` / `pipx` / `uv tool install`, then the vendor's install script from their own domain.
2. Never use `sudo` without asking. Never download from a mirror, a gist or a random site.
3. Check it works: `<cli> --version`. If the command is not found right after installing, find where it was installed and fix the shell config (`~/.zshrc` or `~/.bashrc`), then tell the user in one line what you changed.

## Step 4: Connect the account

1. Prefer the CLI's own login (`<cli> login`, `<cli> auth login`): it opens the browser and the user clicks "Allow". Run it and tell the user what to click.
2. If the tool needs an API key or token instead: tell the user exactly where to create it (page and button names), and ask them to put it in their shell config themselves, for example `export NOTION_API_TOKEN=...` in `~/.zshrc`. Never ask them to paste a key in the chat, never write a key in a skill, a repo or a project file.
3. Prove it works with one harmless read-only command (list workspaces, whoami, list projects). Show the user the result in one line.

## Step 5: Learn the CLI

Before writing anything, read the real CLI, never guess:

- `<cli> --help`, then `--help` on each main command group.
- The official docs page for the commands people use most.
- Note which commands only read and which create, change, delete, send or spend money.

## Step 6: Write the skill

Create `~/.agents/skills/<tool>-cli/SKILL.md`. Keep it under 60 lines, in English, written for an agent:

```markdown
---
name: <tool>-cli
description: <What it does with <tool>> with `<cli>`. Use when <the 4-6 most common things the user will ask, in their words: create a page, query a database, upload a file...>.
---

Use `<cli>` for <tool>. Never invent commands or flags: check `--help` first.

Inspect first:

    <cli> --help
    <cli> <group> --help

If missing: `<official install command>`.

Auth: <login command, or the variable name to use, e.g. `NOTION_API_TOKEN`>. Check with `<harmless command>`. Never print or store the key.

## Common tasks

- <Task>: `<exact command>`
- <Task>: `<exact command>`
- ...

## Rules

- Read before writing. Ask the user before anything that deletes, publishes, sends or spends money.
- Docs: <official docs URL>
```

Only put commands you actually saw in `--help` or the official docs. Keep 5 to 10 common tasks, the ones the user will really ask for.

## Step 7: Make it available everywhere

1. `~/.agents/skills/<tool>-cli/` is the single source. It is read by Codex and most agents.
2. Claude Code reads `~/.claude/skills/`. Make the skill visible there without copying it:
   - if `~/.claude/skills` is already a link to `~/.agents/skills`, there is nothing to do;
   - otherwise create the folder if needed (`mkdir -p ~/.claude/skills`) and link it: `ln -s ~/.agents/skills/<tool>-cli ~/.claude/skills/<tool>-cli`.
3. Never put a real copy in `~/.claude/skills/`: two copies drift apart.

## Step 8: Check and hand over

Show a short list with a check or a cross:

- the CLI is installed (`<cli> --version`)
- the account is connected (the harmless command works)
- `~/.agents/skills/<tool>-cli/SKILL.md` exists
- `~/.claude/skills/<tool>-cli/SKILL.md` opens the same file

Then tell the user, in 3 lines max:

- which CLI you installed and which account it is connected to;
- that they need a new session (or a restart of Claude Code) to see the skill, then they type `/<tool>-cli` or just ask in plain words;
- one concrete thing to try right now, for example "List my last 5 Notion pages".
