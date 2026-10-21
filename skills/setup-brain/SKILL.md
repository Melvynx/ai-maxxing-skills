---
name: setup-brain
description: Set up the user's "brain", a single folder where their agent organises everything by project (projects, sub-projects, notes, skills). Use when the user wants to set up their brain, organise their work with their agent, or starts from zero.
argument-hint: "[path, default ~/brain]"
---

Set up the user's brain: one folder, run by their agent, where every piece of work lives in a project, so any future session can read one file and know who the user is, what they work on and where everything is. Talk to the user in their language, one short question at a time, with no jargon (never say "frontmatter", "kebab-case" or "symlink" to them).

If you got this skill from a link instead of a local folder, install nothing else from the repo: download a file it links only when a step needs it, with `curl -fsSL https://raw.githubusercontent.com/Melvynx/ai-maxxing-skills/main/skills/setup-brain/<path> -o <scratch>/<file>` (for example `references/agents-md.md`), and read another skill it names only when you reach it, from `https://raw.githubusercontent.com/Melvynx/ai-maxxing-skills/main/skills/<skill-name>/SKILL.md`.

1. Use the argument as the target folder, otherwise `~/brain`, and confirm it in one line. If it already exists and is not empty, overwrite nothing: read what is there, tell the user what you found, and only add what is missing.
2. Ask these one by one, accept short answers, and move on if they skip one:
   1. Your first name, what you do, and your time zone?
   2. Your businesses or products (name + one line each)? "None yet" is fine.
   3. What are you working on right now? List 3 to 5 things, work or personal.
   4. How do you like your agent to talk to you (short and direct, or detailed and step by step)?
   5. Where do your goals or notes already live (Notion, Obsidian, Google Docs, nowhere)?
3. Create the structure below and a `.gitignore` with `.tmp/`, `.DS_Store`, `node_modules/`, `.env*`.
4. Write `AGENTS.md` from the interview with [references/agents-md.md](references/agents-md.md). It is the single guide for every agent: never create a `CLAUDE.md`.
5. For each business from question 2, create a hub in `projects/<slug>/`; for each item from question 3, create a project inside the right hub (or at `projects/` root if none fits). Always create the `perso/` hub. Give every hub and project an `About.md` from [references/about-md.md](references/about-md.md). Write only what the user told you and leave "To fill" rather than guess a fact, number or link. Add `Roadmap.md` only for real next steps, and `files/`, `assets/`, `output/` only when there is something to put in them.
6. Write the projects skill from [references/projects-skill.md](references/projects-skill.md) to `.agents/skills/projects/SKILL.md` and link it from `.claude/skills/projects`.
7. Run `git init` and a first commit "brain: initial setup". Ask if they want a private GitHub repo so they never lose it; create and push only on yes, always private.

```text
<brain>/
├── AGENTS.md          The single guide for every agent
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

Finish with a short check list, a check or a cross on each line: `AGENTS.md` exists and there is no `CLAUDE.md`, every folder above exists, every project has an `About.md` with a status, the `projects` skill is installed and linked, git is initialised (and pushed if they chose GitHub). Then tell the user in 3 lines where their brain is, that from now on they just say "load project X" or "create a project for Y" and the agent keeps everything tidy, and one concrete thing to try right now based on their projects.
