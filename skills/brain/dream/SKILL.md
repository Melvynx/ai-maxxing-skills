---
name: dream
description: Tidy the whole brain like sleep tidies memory. Goes over what was said and saved since the last dream, in every tool (Claude Code, Codex), and consolidates it - merges duplicates, fixes facts that are no longer true, turns relative dates into real ones, folds journal lines into the projects, keeps the user's rules in one place. Also runs on its own in the background about once a day. Use when the user types /dream, says "range le cerveau", "consolide", "fais le ménage dans les notes" or "tidy the brain".
metadata:
  internal: true
---

`/done` saves one conversation right after it ends: fast, one project at a time. A dream is the slow pass that comes later, over everything saved since the last dream, so the brain stays true and short instead of growing a new line after every session. The brain is the folder named in the `## Brain` section of `~/.claude/CLAUDE.md` (default `~/brain`): read its `AGENTS.md` first. Talk to the user in their language, without jargon. Write every file in English.

1. **Orient.** Find the last dream: `git log -1 --grep='^dream' --format='%H %ci'` (none: the last 7 days). List what moved since: `git log --format='%h %ci %s' <hash>..HEAD` and `git diff --stat <hash>..HEAD`. Read the brain `AGENTS.md`, the journal files of those days and the `About.md` of every project they touched.
2. **Gather.** Get what the user said since then, in every tool: the prompt gives the file in automatic mode, otherwise run `node .agents/skills/done/scripts/auto-done.mjs dream-notes` and read the file it prints. Read it for signal only, never top to bottom as a story: corrections ("no", "not like that", "I said"), "always" and "never", "remember", decisions with their reason, new ids, links, numbers, and what the user said is finished or dropped. Check each one against the files: most are already saved.
3. **Consolidate.** For each project touched:
   - Write a missing fact or decision where it belongs, and a reason only when the user gave one (the `## Decisions` format of the done skill).
   - When two lines say the same thing, keep one. When a newer fact contradicts an older one, keep the newer and remove the older: one fact, one place.
   - Replace relative dates ("tomorrow", "next week", "jeudi") with the real date, from the day they were written.
   - Remove what is no longer true from the current state: a finished task stays only as a ticked line in `Roadmap.md`, a done launch becomes one line of result.
   - Set `updated:` to today on each `About.md` you changed, and `status: done` when the user said a project is finished (`/cleanup` archives it later).
4. **Notes.** Fold into the project each journal line, idea or todo that clearly belongs to one, and leave the journal files themselves as they are (a journal is history). Merge duplicate ideas and todos into one line. A todo the user said is done becomes ticked, never deleted.
5. **Patterns.** A correction or rule that came back in two conversations or more: write it once where it applies, the project's `About.md` or the brain `AGENTS.md` for all the brain. A rule for every folder, or a workflow done twice that could become a skill, becomes a line in `notes/todos/` ("Proposal: ...") for the user to decide.
6. **Index.** Keep the brain `AGENTS.md` short (under about 200 lines): move project details into their `About.md` and keep one line per hub or project. Fix paths and links that point to files that moved.
7. **Save.** Add one line to `notes/journal/<today>.md`: `dream: <what moved, in a few words>`. Commit everything with `git add -A` and a message `dream: <what changed>`, and push when the brain has a GitHub copy. When nothing needed a change, commit nothing.
8. **Tell.** In 3 to 5 short lines: what you merged, fixed or moved, and every proposal you left in `notes/todos/`.

Never:

- Delete a file, a project or a journal day: moving and archiving are the `/cleanup` skill's job.
- Write outside the brain, or in the global `~/.agents/AGENTS.md` or `~/.claude/CLAUDE.md`.
- Invent a fact, a date or a reason. When two files disagree and nothing says which is right, keep both lines and add a todo asking the user.
- Rewrite a whole file. Edit lines, and read a file again right before you edit it: another conversation may be saving at the same time.

## Automatic mode

The script of the done skill ([../done/scripts/auto-done.mjs](../done/scripts/auto-done.mjs)) runs this skill on its own, in the background, at most once a day: when the last dream is 24 hours old, at least 5 conversations were saved since, nothing is left to save and no brain conversation was active in the last 20 minutes. The prompt then says "automatic mode" and gives the file with what the user said since the last dream. Nobody is there to answer, so:

- Ask nothing and wait for nothing. Whatever would need the user becomes a line in `notes/todos/`.
- Make only changes you are sure of. When in doubt, leave the file as it is.
- When git refuses to commit (a sandboxed agent), write the commit message in the file the prompt names and stop: the script commits and pushes.
- End with one line saying what changed; nobody reads more.
