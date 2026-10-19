Write this as `.agents/skills/projects/SKILL.md` in the brain.

```markdown
---
name: projects
description: Manage project lifecycle in the brain: create, load, archive, list
argument-hint: <create|load|archive|list> <name-or-description>
---

Manage projects in `projects/` following the Projects and Hygiene sections of `AGENTS.md`.

- `create <description>`: look for an existing project or hub first. If one fits, create the sub-project inside it. Otherwise create `projects/<slug>/` with an `About.md`. Add subfolders only as the work needs them.
- `load <name>`: find the folder (search `projects/**/About.md`), read `About.md` first, then only the files the task needs. Update `About.md` and `updated:` when something important changes.
- `archive <name>`: fold the final outcome into `About.md`, set `status: done`, trash scratch files, keep deliverables, move the folder to `archives/<slug>/`.
- `list [status]`: read the status of every `projects/**/About.md` and show name, status, updated, one-line summary. Flag projects not updated for 60+ days as archive candidates.
```
