The block that tells every agent the VPS exists. Fill it with the real values from the `test` output, in the user's language for the sentences, and keep the commands as they are. Replace `hermes` with the alias if the user picked another one.

```markdown
## VPS

A VPS is ready for you: `ssh hermes` (<provider>, <ip>, <os>, <cpu> CPU, <ram> RAM, <disk>). It is the user's server, where their sites, apps, databases and agents run 24/7.

- Run commands with `ssh hermes '<command>'`, one short command per call, and read the output before the next one.
- Copy files with `scp <file> hermes:<path>` or `rsync -av <folder>/ hermes:<path>/`.
- Ask the user before anything that can cut access or break what runs: changing the SSH config or the firewall, rebooting, deleting files or containers, or upgrading the OS.
- Never print passwords or keys from the server in the chat.
```

Where to write it, keeping every existing line of each file:

1. The brain `AGENTS.md`, if the user has one (`setup-brain` skill): add the block as its own `## VPS` section, or replace the old one if it is already there.
2. Claude Code, for every folder: write the block alone to `~/.claude/rules/vps.md` (create `~/.claude/rules/` if missing). Claude Code loads every file of that folder in every session.
3. Codex, if `~/.codex` exists: add or replace the same `## VPS` section in `~/.codex/AGENTS.md`.

Never create a `CLAUDE.md` in a project for this. If a section `## VPS` already lists another server, add a line for the new alias instead of replacing it.
