---
name: create-cli-skills
description: Build a one-file Python CLI and global skill for a tool with no official CLI (ClickFunnels, Kajabi...), using its API key. Use for "create-cli-skills clickfunnels", "make a CLI for X", "connect X with my API key".
argument-hint: "<tool name, e.g. clickfunnels>"
---

Turn a tool's API into a small CLI skill the user's agents can use from any folder. Talk to the user in their language, one short question at a time, no jargon.

1. Confirm the tool (fix typos). If it has an official CLI, use `setup-cli-skills` instead. If `~/.agents/skills/<tool>-cli/` exists, read it and ask before changing it.
2. Read the official API docs (vendor domain only): base URL, auth header, extra values like a subdomain or workspace id, and the endpoints behind the 5 to 10 things the user will really ask. Note where the key is created.
3. Copy [scripts/cli_template.py](scripts/cli_template.py) to `~/.agents/skills/<tool>-cli/scripts/<tool>.py`. Fill the constants, `auth_headers`, `SETTINGS`, and `COMMANDS` with confirmed endpoints only; `check` must be a cheap read. Keep it stdlib-only.
4. Get the key. Tell the user exactly where to create it (page and button), with the narrowest permissions that cover their tasks. Best: they run `python3 ~/.agents/skills/<tool>-cli/scripts/<tool>.py login` in their terminal (hidden input). If they paste it in the chat instead, pipe it straight in: `printf '%s' '<key>' | python3 .../<tool>.py login --<setting> <value>`. Never repeat the key, never write it anywhere but that config file.
5. Run `check` and one real read (list a few items). Fix the script until both work.
6. Write `~/.agents/skills/<tool>-cli/SKILL.md`, under 30 lines, in this style:

```markdown
---
name: <tool>-cli
description: <Tool> from the terminal: <main resources>. Use when the user asks to <4-6 real tasks in their words>.
---

Run `python3 ~/.agents/skills/<tool>-cli/scripts/<tool>.py <command>`. Start with `help`; any other endpoint: `api <METHOD> <path>` (docs: <url>).

No key: tell the user to run `login` in their terminal (key from <where>).

- <Task>: `<command> [args]`
- ...

Read before writing. Ask before anything that deletes, publishes, sends, or spends money; deletes need `--yes`.
```

7. Link it for Claude Code: if `~/.claude/skills` is not already a link to `~/.agents/skills`, run `mkdir -p ~/.claude/skills && ln -s ~/.agents/skills/<tool>-cli ~/.claude/skills/<tool>-cli`.

Finish with three lines: what the CLI can do, that a new session shows `/<tool>-cli`, and one thing to try now.
