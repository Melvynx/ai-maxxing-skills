Write this as `~/.agents/skills/done/SKILL.md`, with `<brain>` replaced by the brain's full path, so `/done` works in every folder, including the big projects kept outside the brain.

```markdown
---
name: done
description: Close a work session: save what changed into the right project (About.md, Roadmap.md, journal), capture loose ideas and todos, turn a repeated workflow into a skill, then save the brain. Use when the user types /done, says "on a fini", "sauvegarde", "c'est bon pour aujourd'hui" or ends a conversation.
---

Close this conversation so the next session starts from the files, not from memory. The brain is `<brain>`: read its `AGENTS.md` if you have not this session. Talk to the user in their language, without jargon.

1. Go back over the whole conversation and list what is worth keeping: decisions, results, new ids, links, numbers, paths, what is finished, what is next, and anything the user corrected about how you work. Skip what the files or git already say.
2. Find the project it belongs to (`projects/**/About.md`). If the work fits no project and will continue, create one as `AGENTS.md` says; a one-off question gets no project.
3. Update `About.md`: fold the new facts into the current state, replace what is no longer true instead of adding below it, set `updated:` to today, change `status` when the project is paused or done. One fact, one place.
4. Update `Roadmap.md`: tick what is finished, add the real next steps, remove dead ones. Create it only when there are open tasks.
5. Add one line per project touched to `notes/journal/<today>.md` (`YYYY-MM-DD.md`): the project and what moved. An off-topic idea the user mentioned goes in `notes/ideas/`, a loose todo in `notes/todos/`, as a line in an existing file when one fits.
6. When the user corrected how you work or said "always" or "never", write it where it applies: that project's `About.md`, the brain `AGENTS.md` for all the brain, or the `## Output style` of `~/.claude/CLAUDE.md` for every folder. When the conversation did a workflow they will do again, or a skill misbehaved, use the `skill-manager` skill to create or fix that skill (ask first in one line).
7. When you worked in a folder outside the brain, put facts about its code in that folder's own `AGENTS.md`, and the project state in the brain project's `About.md`.
8. Trash the scratch files this session left in `.tmp/` that nothing needs. In the brain, commit everything with `git add -A` and a message `done: <project>: <what changed>`, and push when the brain has a GitHub copy.
9. Tell the user in 3 to 5 short lines what you saved and where, and the next step from the roadmap.
```
