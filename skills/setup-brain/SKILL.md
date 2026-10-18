---
name: setup-brain
description: Set up the user's "brain", a single folder where their agent organises everything by project (projects, sub-projects, notes, skills). Use when the user wants to set up their brain, organise their work with their agent, or starts from zero.
argument-hint: "[path, default ~/brain]"
---

# Setup brain

You are setting up the user's **brain**: one folder, run by their agent, where every piece of work lives in a project. The goal is that any future session can open this folder, read one file, and know who the user is, what they work on, and where everything is.

Talk to the user in their language. Ask one question at a time, short and simple. Never use jargon (no "frontmatter", "kebab-case", "symlink" in what you say to them).

## Step 1: Check before creating

1. Target folder: the argument if given, otherwise `~/brain`. Confirm it with the user in one line.
2. If the folder already exists and is not empty, do not overwrite anything. Read what is there, tell the user what you found, and only add what is missing.

## Step 2: Interview (5 questions max)

Ask these one by one, accept short answers, and move on if they skip one:

1. Your first name, what you do, and your time zone?
2. Your businesses or products (name + one line each)? "None yet" is fine.
3. What are you working on right now? List 3 to 5 things, work or personal.
4. How do you like your agent to talk to you (short and direct, or detailed and step by step)?
5. Where do your goals or notes already live (Notion, Obsidian, Google Docs, nowhere)?

## Step 3: Create the structure

```text
<brain>/
├── AGENTS.md          The single guide for every agent (written in step 4)
├── CLAUDE.md          One line: @AGENTS.md
├── projects/          Active work. One folder = one project.
├── archives/          Finished or abandoned projects. Read-only reference.
├── notes/
│   ├── journal/       Daily notes, one file per day (YYYY-MM-DD.md)
│   ├── ideas/         Ideas not yet started
│   └── todos/         Loose todos not tied to a project
├── prompts/           Reusable prompts
├── scripts/           Small scripts and automations
├── .agents/skills/    The user's skills (single source)
├── .claude/skills/    Links pointing to .agents/skills/, never real copies
└── .tmp/              Scratch, logs, screenshots. Delete freely.
```

Add a `.gitignore` with `.tmp/`, `.DS_Store`, `node_modules/`, `.env*`.

## Step 4: Write AGENTS.md

Fill it from the interview. Keep it under 120 lines. Use this skeleton:

```markdown
# <First name>'s brain

Personal command center, run by agents. Everything is organised by **project**. `CLAUDE.md` only imports this file, so this is the single guide for every agent.

## <First name>

- <What they do>, based in <place> (<time zone>).
- Products: <list, or "none yet">.
- Style: <how they want the agent to talk>.
- Goals and notes live in <tool>. Read them when priorities matter.

## Layout

<the tree from step 3, one line per folder>

Nothing else belongs at the root. No loose files, no new top-level folders.

## Projects

Every piece of work belongs to a project folder in `projects/<slug>/` (lowercase, dashes). Before creating one, look for an existing project or hub that fits.

Hubs (sub-projects go inside, not next to them):

- <one hub per business or big area, e.g. `my-saas/`: product, marketing, ops>
- `perso/`: health, finance, home, travel

Each project has:

- `About.md` (required): status + what it is, key ids/links, current state. Read it first, update it when something important changes.
- `Roadmap.md` (optional): plain checkbox todo list, only if the project has real open tasks.
- `files/` for text notes, `assets/` for inputs, `output/` for deliverables.

Status lifecycle: `active` while working, `paused` when parked, `done` when shipped. A `done` project moves to `archives/<slug>/` (keep the folder intact).

## Hygiene

- One fact, one place. Update `About.md` or an existing file before creating a new one.
- No per-step reports, status dumps or `final-v2.md` files. When a task is finished, fold the useful result into `About.md` and delete the rest.
- Scratch, screenshots and logs go in `.tmp/` or the project `output/`, never at the root.
- File names: `Title Case.md` or lowercase-with-dashes, `.md` for text.
- Delete by moving to the trash, never permanently. Archive instead of deleting anything with value.
- When you notice duplicates or a project living outside its hub, move it and fix the paths that pointed to it.

## Skills

Every reusable workflow is a skill in `.agents/skills/<name>/SKILL.md`. `.claude/skills/` only holds links to it.
```

Then write `CLAUDE.md` with the single line `@AGENTS.md`.

## Step 5: Create the first projects

For each business from question 2, create a hub in `projects/<slug>/`. For each item from question 3, create a project inside the right hub (or at `projects/` root if no hub fits). Always create the `perso/` hub.

Every hub and project gets an `About.md`:

```markdown
---
status: active   # active | paused | done
updated: <today, YYYY-MM-DD>
---

# <Name>

<One paragraph: what it is and the goal.>

## Key info
- Links, ids, accounts, paths

## Current state
- What is done, what is next (short)
```

Only write what the user told you. Never invent facts, numbers or links: leave a section with "To fill" rather than guess. Add `Roadmap.md` only if they named real next steps. Create `files/`, `assets/`, `output/` only when there is something to put in them.

## Step 6: Install the projects skill

Create `.agents/skills/projects/SKILL.md` so the agent can manage projects later, then link it from `.claude/skills/projects`:

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

## Step 7: Save it with git

1. `git init` in the brain, then a first commit "brain: initial setup".
2. Ask the user if they want a **private** GitHub repo so they never lose it. Only create and push if they say yes, and always private.

## Step 8: Check and hand over

Run a final check and show the result as a short list with a check or a cross:

- `AGENTS.md` and `CLAUDE.md` exist, and `CLAUDE.md` imports `AGENTS.md`
- every folder from step 3 exists
- every project has an `About.md` with a status
- the `projects` skill is installed and linked
- git is initialised (and pushed, if they chose GitHub)

Then tell the user, in 3 lines max:

- where their brain is;
- that from now on they just say "load project X" or "create a project for Y", and the agent keeps everything tidy;
- one concrete thing to try right now, based on their current projects.
