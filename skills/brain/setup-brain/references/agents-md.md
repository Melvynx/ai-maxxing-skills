Skeleton for the brain's `AGENTS.md`. Fill it from the interview, keep it under 120 lines.

```markdown
# <First name>'s brain

Personal command center, run by agents. Everything is organised by **project**. Claude Code and Codex both read this file natively, so it is the single guide for every agent. Never create a `CLAUDE.md`.

## <First name>

- <What they do>, based in <place> (<time zone>).
- Products: <list, or "none yet">.
- Tech level: <not technical | tinkers | developer (stack)>. How to talk to them and how much to do alone is in the `## Output style` of the global rules: follow it here too.
- Tools every day: <list from the interview>.
- Never without asking: <their rules, or "nothing special">.
- Goals and notes live in <tool>. Read them when priorities matter.

## Layout

- `AGENTS.md`: this guide.
- `projects/`: one folder per project, each with its `About.md`.
- `archives/`: finished projects, read-only (created with the first archive).
- `.tmp/`: scratch, logs, screenshots, delete freely (created when needed, ignored by git).

Nothing else belongs at the root. No loose files, no new top-level folders. Never create a folder before there is something to put in it.

## Projects

Every piece of work belongs to a project folder in `projects/<slug>/` (lowercase, dashes). Before creating one, look for an existing project or hub that fits.

Hubs (sub-projects go inside, not next to them):

- <one hub per business or big area, e.g. `my-saas/`: product, marketing, ops>
- `perso/`: health, finance, home, travel (only once there is something personal)

Each project has:

- `About.md` (required): status + what it is, key ids/links, current state. Read it first, update it when something important changes.
- `Roadmap.md` (optional): plain checkbox todo list, only if the project has real open tasks.
- `files/` for text notes, `assets/` for inputs, `output/` for deliverables, each created with its first file only.

Status lifecycle: `active` while working, `paused` when parked, `done` when shipped. A `done` project moves to `archives/<slug>/` (keep the folder intact).

## Hygiene

- An idea or a todo goes in the `Roadmap.md` of the project it belongs to, or of `perso/` when none fits (create it with its `About.md` the first time). No separate notes, ideas or todos folders.
- One fact, one place. Update `About.md` or an existing file before creating a new one.
- No per-step reports, status dumps or `final-v2.md` files. When a task is finished, fold the useful result into `About.md` and delete the rest.
- Scratch, screenshots and logs go in `.tmp/` or the project `output/`, never at the root.
- File names: `Title Case.md` or lowercase-with-dashes, `.md` for text.
- Delete by moving to the trash, never permanently. Archive instead of deleting anything with value.
- When you notice duplicates or a project living outside its hub, move it and fix the paths that pointed to it.

## Skills

Skills live in `~/.agents/skills/` (linked in `~/.claude/skills/`) and work in every folder. Create or fix a skill with `skill-manager`.

- `/create-project`: a short interview, then the project folder with its `About.md` and `Roadmap.md`. Use it for every new project.
- `projects`: load, list or archive a project ("load project X").
- `/done`: at the end of a work session, updates the project's `About.md` and `Roadmap.md`, then commits the brain. If the user forgets and a lot changed, offer it.
- `/cleanup`: proposes what to archive, merge or move. Offer it when `projects/` holds projects untouched for 60 days.
```
