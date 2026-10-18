---
name: setup-cli-skills
description: Install a tool's official CLI (Notion, Stripe, GitHub...), log it in, and create a global skill for it. Use for "setup-cli-skills notion", "install the X CLI", "make a skill for X".
argument-hint: "<tool name, e.g. notion>"
---

Give the user's agents a new tool through its official CLI, usable from any folder. Talk to the user in their language, one short question at a time, no jargon.

1. Confirm the tool (fix typos: "mtoin" is Notion). If `~/.agents/skills/<tool>-cli/` exists, read it and ask before changing it.
2. Find the CLI published by the vendor itself (their docs, domain, or GitHub org) and check if it is already installed with `command -v`. No official CLI: use `create-cli-skills` instead.
3. Install with the documented method, preferring `brew` on macOS, then the vendor's `npm i -g` / `pipx` / `uv tool install`, then their own install script. Ask before `sudo`. Check `<cli> --version`; if not found, fix the shell PATH and say so in one line.
4. Log in with the CLI's own browser login when it has one. If it needs a key, tell the user where to create it and to add `export <VAR>=...` to `~/.zshrc` themselves. Prove it works with one read-only command.
5. Read `<cli> --help`, the main subcommands' `--help`, and the docs for the common tasks. Never guess commands.
6. Write `~/.agents/skills/<tool>-cli/SKILL.md`, under 30 lines, with only commands you saw:

```markdown
---
name: <tool>-cli
description: <Tool> with `<cli>`: <main resources>. Use when the user asks to <4-6 real tasks in their words>.
---

Use `<cli>`; check `<cli> <group> --help` before any command you have not run. Missing: `<install command>`. Auth: `<login or VAR>`, check with `<read-only command>`.

- <Task>: `<command>`
- ...

Read before writing. Ask before anything that deletes, publishes, sends, or spends money. Docs: <url>.
```

7. Link it for Claude Code: if `~/.claude/skills` is not already a link to `~/.agents/skills`, run `mkdir -p ~/.claude/skills && ln -s ~/.agents/skills/<tool>-cli ~/.claude/skills/<tool>-cli`.

Finish with three lines: which CLI and account are connected, that a new session shows `/<tool>-cli`, and one thing to try now.
