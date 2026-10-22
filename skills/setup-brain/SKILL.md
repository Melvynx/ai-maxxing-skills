---
name: setup-brain
description: Set up the user's "brain", a single folder where their agent organises everything by project (projects, sub-projects, notes, skills), after an interview about who they are, their technical level and how they want their agent to work. Writes that working style into the global rules of every agent (and Hermes on their server), and installs /done and skill-manager. Use when the user wants to set up or initialize their brain, organise their work with their agent, or starts from zero.
argument-hint: "[path, default ~/brain]"
---

Set up the user's brain: one folder, run by their agent, where every piece of work lives in a project, so any future session can read one file and know who the user is, what they work on and where everything is. Before building anything, interview them, then write how they want to be talked to into the global rules, so every agent in every folder (and Hermes on their server) works their way from now on. Talk to the user in their language, one short question at a time, with no jargon (never say "frontmatter", "kebab-case", "symlink" or "repo" to them).

If you got this skill from a link instead of a local folder, install nothing else from the repo: download a file it links only when a step needs it, with `curl -fsSL https://raw.githubusercontent.com/Melvynx/ai-maxxing-skills/main/skills/setup-brain/<path> -o <scratch>/<file>` (for example `references/agents-md.md`), and read another skill it names only when you reach it, from `https://raw.githubusercontent.com/Melvynx/ai-maxxing-skills/main/skills/<skill-name>/SKILL.md`.

1. **Folder.** Use the argument as the target folder, otherwise `~/brain`, and confirm it in one line. If it already exists and is not empty, overwrite nothing: read its `AGENTS.md` and projects, tell the user what you found, skip the questions it already answers, and only add what is missing.
2. **Interview.** Say in one line why you ask (so the agent knows them and works their way), then ask the questions below, one per message, and wait for each answer. Give the choices or an example with every question so they never have to guess what you mean; use your multiple-choice question tool for 2, 3 and 4 when you have one. Accept short answers, rephrase once if an answer is unclear, never ask again what an earlier answer already told you, and move on if they skip one.
   1. Your first name, what you do in one sentence, and the city or time zone you work from?
   2. Your level with tech? Pick the closest: "I don't code and never use a terminal", "I tinker (no-code tools, tutorials, a terminal now and then)", or "I'm a developer". For a developer, ask their main languages and tools in the same message.
   3. How should your agent work? "Do everything for me and only ask what truly needs me" (recommended when they don't code), or "Step by step: show me the plan and I approve each step".
   4. In which language should it answer, and how: short and direct, or detailed?
   5. Your businesses or products, a name and one line each? "None yet" is fine.
   6. What are you working on right now? 3 to 5 things, work or personal.
   7. Which tools do you use every day? For example email (Gmail, Outlook), calendar, notes (Notion, Obsidian, Apple Notes), payments (Stripe), social networks, a newsletter tool.
   8. Where do your goals, plans or notes already live? A tool from question 7, somewhere else, or nowhere.
   9. Is there anything your agent must never do without asking you first? For example send an email in your name, pay for something, publish a post. "Nothing special" is fine.
   10. If your agent could take one task off your plate this week, which one would it be?
3. **Check.** Sum it up in 5 short lines (who they are, their level, how the agent will work, their businesses and current work, the never rules) and ask if it is right. Fix what they correct before writing anything.
4. **Global rules.** Build the `## Output style` block from answers 2, 3, 4 and 9 with [references/output-style.md](references/output-style.md). Write it in `~/.claude/CLAUDE.md` (the rules Claude Code reads in every folder; the one `CLAUDE.md` this skill writes) and in `~/.codex/AGENTS.md` when the `~/.codex` folder exists. Create the file when missing. When it already has a `## Output style` section, replace that section up to the next `## ` heading and keep every other line; otherwise add the block at the end, after one blank line. Then tell the user in one plain line what changes: for a non-technical user, "From now on your agents do the technical part themselves and explain things simply."
5. **Folders.** Create the structure below and a `.gitignore` with `.tmp/`, `.DS_Store`, `node_modules/`, `.env*`.
6. **AGENTS.md.** Write it from the interview with [references/agents-md.md](references/agents-md.md). It is the single guide for every agent working in the brain: never create a `CLAUDE.md` inside the brain.
7. **Projects.** For each business from question 5, create a hub in `projects/<slug>/`; for each item from question 6, create a project inside the right hub (or at `projects/` root if none fits). Always create the `perso/` hub. Give every hub and project an `About.md` from [references/about-md.md](references/about-md.md). Write only what the user told you and leave "To fill" rather than guess a fact, number or link. Put the task from question 10 as the first line of the `Roadmap.md` of the project it belongs to (or of `perso/`). Add `Roadmap.md` only for real next steps, and `files/`, `assets/`, `output/` only when there is something to put in them.
8. **Skills.** Write the projects skill from [references/projects-skill.md](references/projects-skill.md) to `.agents/skills/projects/SKILL.md` and link it from `.claude/skills/projects`. Then install two skills for every folder: `done` from [references/done-skill.md](references/done-skill.md) (with the brain path filled in), which saves each conversation into the right project when they type `/done`, and `skill-manager` from [references/skill-manager-skill.md](references/skill-manager-skill.md), which creates and fixes their skills. Write each to `~/.agents/skills/<name>/SKILL.md` and link it from `~/.claude/skills/<name>` unless `~/.claude/skills` already links to `~/.agents/skills`. If one already exists, ask before replacing it.
9. **Save.** Run `git init` and a first commit "brain: initial setup". Ask if they want a private copy on GitHub so they never lose it; create and push only on yes, always private.
10. **Hermes.** If they already have a server agent (`ssh -o BatchMode=yes hermes true` works and `ssh hermes 'command -v hermes-setup' < /dev/null` finds it), give Hermes the same style: `awk '/^## Output style[[:space:]]*$/{f=1;print;next} f&&/^## /{f=0} f' ~/.claude/CLAUDE.md | ssh hermes 'hermes-setup style'`. It answers `style ok`. Without a server, skip this step: `setup-vps` does it when they set one up.

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

Finish with a short check list, a check or a cross on each line: interview done and confirmed, `## Output style` in `~/.claude/CLAUDE.md` (and `~/.codex/AGENTS.md` if Codex is there), `AGENTS.md` exists and there is no `CLAUDE.md` in the brain, every folder above exists, every project has an `About.md` with a status, the `projects` skill is installed and linked, `done` and `skill-manager` are in `~/.agents/skills` and linked, git is initialised (and pushed if they chose GitHub), Hermes has the style (or "no server yet"). Then tell the user in 3 lines where their brain is, that from now on they just say "load project X" or "create a project for Y" and the agent keeps everything tidy, that typing `/done` at the end of each conversation saves it into the project, and offer to start on their answer to question 10 right now.
