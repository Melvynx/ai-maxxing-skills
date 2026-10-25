---
name: done
description: Close a work session. Saves what changed into the right brain project (About.md with the reason behind each decision, Roadmap.md, journal), captures loose ideas and todos, turns a repeated workflow into a skill, then saves the brain. Also runs on its own in the background after a brain conversation goes quiet. Use when the user types /done, says "on a fini", "sauvegarde", "c'est bon pour aujourd'hui" or ends a conversation.
metadata:
  internal: true
---

Close this conversation so the next session starts from the files, not from memory. The brain is the folder named in the `## Brain` section of `~/.claude/CLAUDE.md` (default `~/brain`): read its `AGENTS.md` if you have not this session. Talk to the user in their language, without jargon. Write every file in English.

1. Go back over the whole conversation and list what is worth keeping: decisions and the reason behind each one, options that were tried or rejected and why, results, new ids, links, numbers, paths, what is finished, what is next, and anything the user corrected about how you work. Skip what the files or git already say.
2. Find the project it belongs to (`projects/**/About.md`). If the work fits no project and will continue, create one with the `create-project` skill, without its interview: fill it from the conversation and confirm the name and place in one line. A one-off question gets no project.
3. Update `About.md`: fold the new facts into the current state, replace what is no longer true instead of adding below it, set `updated:` to today, change `status` when the project is paused or done. One fact, one place.
4. Write the reasons in the `## Decisions` section of `About.md` (add the section when missing), one line each: `- <date> <what was decided>, because <why>`, and `- <date> Not <option>, because <why>` for what was rejected, so no future session redoes it. Use the user's own reason when they gave one, and never invent one: when nobody said why, write the decision without "because". When a decision changes, replace its line with the new one and its new reason.
5. Update `Roadmap.md`: tick what is finished, add the real next steps, remove dead ones. Create it only when there are open tasks.
6. Add one line per project touched to `notes/journal/<today>.md` (`YYYY-MM-DD.md`): the project and what moved. An off-topic idea the user mentioned goes in `notes/ideas/`, a loose todo in `notes/todos/`, as a line in an existing file when one fits.
7. When the user corrected how you work or said "always" or "never", write it where it applies: that project's `About.md`, the brain `AGENTS.md` for all the brain, or the `## Output style` of the global `~/.agents/AGENTS.md` for every folder. When the conversation did a workflow they will do again, or a skill misbehaved, use the `skill-manager` skill to create or fix that skill (ask first in one line).
8. When you worked in a folder outside the brain, put facts about its code in that folder's own `AGENTS.md`, and the project state in the brain project's `About.md`.
9. Trash the scratch files this session left in `.tmp/` that nothing needs. Create no folder that stays empty. In the brain, commit everything with `git add -A` and a message `done: <project>: <what changed>`, and push when the brain has a GitHub copy.
10. Tell the user in 3 to 5 short lines what you saved and where, and the next step from the roadmap. When a project was finished, say that `/cleanup` will archive it.

## Automatic mode

The brain's hooks (`.claude/settings.json`, script [scripts/auto-done.mjs](scripts/auto-done.mjs)) run this skill on their own, in the background, about 20 minutes after a brain conversation of at least two messages goes quiet without `/done`. The prompt then says "automatic mode" and gives a file with that conversation's text. Nobody is there to answer, so:

- Read the conversation from that file, not from this session. It holds only what was said since the last save.
- Ask nothing and wait for nothing. Steps 2 and 7 never ask: an obvious new project is created, a doubtful one becomes a line in `notes/ideas/`. A skill to create or fix, or a rule for every folder, becomes a line in `notes/todos/` ("Proposal: a skill for X") instead of being done.
- Write only inside the brain: skip step 8 for other folders.
- When nothing in the conversation is worth keeping (a quick question, a test), change nothing and commit nothing.
- Commit with `done (auto): <project>: <what changed>`, push like step 9, and trash the conversation file. End with one line saying what was saved; nobody reads more.
