---
name: done
description: Close a work session. Saves what changed into the right brain project (About.md, Roadmap.md), captures loose ideas and todos, turns a repeated workflow into a skill, then saves the brain. Use when the user types /done, says "on a fini", "sauvegarde", "c'est bon pour aujourd'hui" or ends a conversation.
metadata:
  internal: true
---

Close this conversation so the next session starts from the files, not from memory. The brain is the folder named in the `## Brain` section of `~/.claude/CLAUDE.md` (default `~/brain`): read its `AGENTS.md` if you have not this session. Talk to the user in their language, without jargon. Write every file in English.

1. Go back over the whole conversation and list what is worth keeping: decisions, results, new ids, links, numbers, paths, what is finished, what is next, and anything the user corrected about how you work. Skip what the files or git already say.
2. Find the project it belongs to (`projects/**/About.md`). If the work fits no project and will continue, create one with the `create-project` skill, without its interview: fill it from the conversation and confirm the name and place in one line. A one-off question gets no project.
3. Update `About.md`: fold the new facts into the current state, replace what is no longer true instead of adding below it, set `updated:` to today, change `status` when the project is paused or done. One fact, one place.
4. Update `Roadmap.md`: tick what is finished, add the real next steps, remove dead ones. Create it only when there are open tasks.
5. An off-topic idea or a loose todo the user mentioned goes as a line in the `Roadmap.md` of the project it belongs to, or of `perso/` when none fits (create it with its `About.md` the first time). Never create a notes, ideas, todos or journal folder: git already keeps the history.
6. When the user corrected how you work or said "always" or "never", write it where it applies: that project's `About.md`, the brain `AGENTS.md` for all the brain, or the `## Output style` of `~/.claude/CLAUDE.md` for every folder. When the conversation did a workflow they will do again, or a skill misbehaved, use the `skill-manager` skill to create or fix that skill (ask first in one line).
7. When you worked in a folder outside the brain, put facts about its code in that folder's own `AGENTS.md`, and the project state in the brain project's `About.md`.
8. Trash the scratch files this session left in `.tmp/` that nothing needs. Create no folder that stays empty. In the brain, commit everything with `git add -A` and a message `done: <project>: <what changed>`, and push when the brain has a GitHub copy.
9. Tell the user in 3 to 5 short lines what you saved and where, and the next step from the roadmap. When a project was finished, say that `/cleanup` will archive it.
