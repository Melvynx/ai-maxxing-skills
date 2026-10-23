---
name: skill-manager
description: Create, improve, audit or delete the user's skills (SKILL.md) for Claude Code and Codex. Use when the user wants a new skill, says "fais-en un skill", "make this a skill", "améliore ce skill", a skill misbehaves, or their skills need cleaning up.
---

A skill is a folder with a `SKILL.md` that teaches the agent one workflow it then applies on its own. Write skills in plain imperative prose: no headings, no bold, a numbered list only for ordered steps. Every line must change what the agent does; cut theory, filler and what the model already does by default. Talk to the user in their language, without jargon.

Where a skill lives, always one source and links elsewhere, never two copies:
- Used in every folder: `~/.agents/skills/<name>/` (Codex reads it there), linked for Claude Code with `mkdir -p ~/.claude/skills && ln -s ~/.agents/skills/<name> ~/.claude/skills/<name>` unless `~/.claude/skills` already links to `~/.agents/skills`.
- Only for the brain or one project: `<folder>/.agents/skills/<name>/`, linked from `<folder>/.claude/skills/<name>`.

To create one:
1. Ask in one message what it should do and 2 or 3 sentences the user would type to start it. When the conversation just did the workflow, propose the skill from what you did and ask them to confirm.
2. Name it in lowercase with dashes, verb first when it acts (`write-newsletter`, `check-invoices`). If a skill already does it, improve that one instead.
3. Write the frontmatter: `name`, and a `description` of 50 to 300 characters, what it does first, then `Use when` and the words the user says. The description is all the agent sees before loading the skill, so it decides when the skill runs. Add `argument-hint` when it takes an input, and `disable-model-invocation: true` when it must run only when the user types it (sending, publishing, paying).
4. Write the body in the order read, act, report, stop: what to read first, the steps, what to show the user at the end. Give the goal and the judgment to apply, not rigid rules. Put commands that always run the same way in `scripts/` and long details (API docs, templates, examples) in `references/`, and say in the body when to open each.
5. Test it on a real case now, or ask the user to type a trigger sentence in a new session. Fix what went wrong in the skill, not only in the result.

To improve one: read it, find the line that caused the wrong behavior (or the missing line), change the fewest lines that fix it, and run it again.

To audit: list the skills in `~/.agents/skills/` (and a project's `.agents/skills/` when one has some). For each line, ask whether removing it changes behavior, and delete no-ops, duplicates and stale rules. Point out skills that overlap or that the user never uses, and move one to the trash only after they agree.

When they have a server agent (`ssh -o BatchMode=yes hermes true < /dev/null` works) and the skill should run there too, copy it with `rsync -a ~/.agents/skills/<name>/ hermes:.agents/skills/<name>/` and link it there with `ssh hermes 'ln -sfn ~/.agents/skills/<name> ~/.claude/skills/<name>' < /dev/null`.

Finish with the skill's path, the sentence that starts it, and how to share it: a public GitHub repo installs with `npx skills add <owner>/<repo>`.
