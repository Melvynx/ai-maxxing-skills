#!/usr/bin/env python3
"""Audit a brain: projects, memories (the Markdown agents read), skills and loose files.

Usage: python3 audit.py [brain folder] [--all] [--no-usage] [--days 60]

Read-only. Prints a Markdown report and saves it in <brain>/.tmp/cleanup-audit.md.
Without a folder, the brain is the path in the `## Brain` section of the global
rules, else ~/brain. `--all` lists every project and skill, not only the flagged ones.
"""
import os, re, subprocess, sys, time
from collections import defaultdict
from datetime import date, datetime

HOME = os.path.expanduser("~")
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
ALL = "--all" in sys.argv
USAGE = "--no-usage" not in sys.argv
DAYS = int(sys.argv[sys.argv.index("--days") + 1]) if "--days" in sys.argv else 60
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "archives", ".tmp", "downloads", ".obsidian"}
ROOT_OK = {".git", ".gitignore", ".ignore", ".agents", ".claude", ".codex", ".obsidian", ".vscode", ".DS_Store",
           ".tmp", "AGENTS.md", "projects", "archives", "notes", "scripts"}
GLOBAL_RULES = ["~/.claude/CLAUDE.md", "~/.agents/AGENTS.md", "~/.codex/AGENTS.md"]
GLOBAL_SKILLS = ["~/.agents/skills", "~/.claude/skills"]


def read(path):
    try:
        return open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        return ""


def brain_root():
    if ARGS:
        return os.path.abspath(os.path.expanduser(ARGS[0]))
    for rules in GLOBAL_RULES:
        m = re.search(r"^## Brain\s*$(.*?)(?=^## |\Z)", read(os.path.expanduser(rules)), re.M | re.S)
        path = m and re.search(r"`([^`]+)`", m.group(1))
        if path:
            return os.path.abspath(os.path.expanduser(path.group(1)))
    return os.path.join(HOME, "brain")


ROOT = brain_root()
TODAY = date.today()
out = []


def p(line=""):
    out.append(line)


def rel(path):
    path = os.path.abspath(path)
    if path.startswith(ROOT + os.sep):
        return os.path.relpath(path, ROOT)
    return path.replace(HOME, "~", 1)


def walk(top, skip=SKIP_DIRS):
    for d, dirs, files in os.walk(top):
        dirs[:] = [x for x in dirs if x not in skip]
        yield d, dirs, files


def git_last(folder):
    r = subprocess.run(["git", "-C", ROOT, "log", "-1", "--format=%cs", "--", folder], capture_output=True, text=True)
    return r.stdout.strip()


def newest(folder):
    best = 0
    for d, _, files in walk(folder, {".git", "node_modules", "__pycache__", ".venv"}):
        for f in files:
            if f != ".DS_Store":
                try:
                    best = max(best, os.path.getmtime(os.path.join(d, f)))
                except OSError:
                    pass
    return datetime.fromtimestamp(best).date().isoformat() if best else ""


def idle(path):
    last = max(git_last(rel(path)), newest(path) if os.path.isdir(path) else
               datetime.fromtimestamp(os.path.getmtime(path)).date().isoformat())
    return (TODAY - date.fromisoformat(last)).days if last else 9999


def front(text, key):
    head = text.split("\n---", 1)[0] if text.startswith("---") else ""
    m = re.search(rf"^{key}:\s*(.+)$", head, re.M)
    return m.group(1).strip().strip("\"'") if m else ""


# ---------------------------------------------------------------- projects
def projects():
    proj = os.path.join(ROOT, "projects")
    rows, nostatus, noabout = [], defaultdict(list), []
    for d, dirs, files in walk(proj):
        if "About.md" not in files:
            parent_has = os.path.exists(os.path.join(os.path.dirname(d), "About.md"))
            if d != proj and os.path.dirname(d) == proj:
                noabout.append(rel(d))
            continue
        text = read(os.path.join(d, "About.md"))
        status = re.match(r"\w+", front(text, "status") or "")
        status = status.group(0) if status else ""
        if not status:
            nostatus[rel(os.path.dirname(d))].append(os.path.basename(d))
            continue
        road = read(os.path.join(d, "Roadmap.md"))
        tasks = len(re.findall(r"^\s*- \[ \]", road, re.M))
        days = idle(d)
        todo = text.count("To fill")
        if status == "done":
            why = "status done, still in projects/"
        elif days >= 60:
            why = f"nothing changed for {days} days"
        elif status == "paused" and days >= 30 and not tasks:
            why = f"paused for {days} days, no open task"
        elif todo >= 3 and days >= 14:
            why = f"About.md still has {todo} 'To fill', untouched for {days} days"
        else:
            why = ""
        rows.append((days, rel(d), status, tasks, why, len(text.split())))
    rows.sort(reverse=True)
    active = sum(1 for r in rows if r[2] == "active")
    p(f"## Projects\n\n{len(rows)} projects ({active} active).")
    flagged = [r for r in rows if r[4]]
    p("\nArchive candidates:" if flagged else "\nNo archive candidate.")
    for days, path, status, tasks, why, _ in flagged:
        p(f"- `{path}` ({status}, {tasks} open tasks): {why}")
    if noabout:
        p("\nFolders in `projects/` with no `About.md`:")
        for x in noabout:
            p(f"- `{x}`")
    if nostatus:
        p("\n`About.md` with no `status:`:")
        for parent, names in sorted(nostatus.items()):
            p(f"- `{parent}/`: " + (", ".join(names) if len(names) <= 3 else f"{len(names)} folders ({names[0]}, ...)"))
    if ALL:
        p("\n| project | status | idle days | open tasks | About words |\n| --- | --- | --- | --- | --- |")
        for days, path, status, tasks, _, words in rows:
            p(f"| `{path}` | {status} | {days} | {tasks} | {words} |")
    return rows


# ---------------------------------------------------------------- memories
def memory_files():
    found = []
    for d, _, files in walk(ROOT):
        r = rel(d)
        if r.startswith(os.path.join("notes", "journal")) or r.startswith("scripts") or r.startswith("raycast") or r.startswith("bun"):
            continue
        for f in files:
            path = os.path.join(d, f)
            if not f.endswith(".md"):
                continue
            in_skill = os.sep + "skills" + os.sep in path
            if in_skill and f != "SKILL.md":
                continue
            if f in ("AGENTS.md", "CLAUDE.md", "About.md", "Roadmap.md", "SKILL.md") or r.startswith("notes"):
                found.append(path)
    seen = {os.path.realpath(x) for x in found}
    for g in GLOBAL_RULES:
        g = os.path.expanduser(g)
        if os.path.exists(g) and os.path.realpath(g) not in seen:
            seen.add(os.path.realpath(g))
            found.append(g)
    return found


def units(text):
    """Yield (line number, sentence) for each sentence of 8 words or more, outside code blocks and frontmatter."""
    code = False
    lines = text.split("\n")
    start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                start = i + 1
                break
    for n, line in enumerate(lines[start:], start + 1):
        if line.strip().startswith("```"):
            code = not code
            continue
        if code or line.lstrip().startswith(("|", "#")):
            continue
        for s in re.split(r"(?<=[.!?;:])\s+", line):
            if len(s.split()) >= 8:
                yield n, s.strip()


def norm(s):
    return re.sub(r"[^a-z0-9àâäçéèêëîïôöùûüÿœ ]+", " ", s.lower()).split()


def memories():
    files = memory_files()
    p(f"\n## Memories\n\n{len(files)} files agents read (AGENTS.md, About.md, Roadmap.md, notes, SKILL.md, global rules), "
      f"{sum(len(read(f).split()) for f in files)} words.")
    # heavy files
    heavy = sorted(((len(read(f).split()), f) for f in files), reverse=True)
    big = [(w, f) for w, f in heavy if w >= 3000 or (os.path.basename(f) == "AGENTS.md" and read(f).count("\n") > 200)]
    if big:
        p("\nHeavy files (3000 words or more, or an AGENTS.md over 200 lines):")
        for w, f in big[:15]:
            p(f"- `{rel(f)}`: {w} words, {read(f).count(chr(10))} lines")
    # duplicates
    items = []  # (file, line, sentence, tokens)
    for f in files:
        if os.path.basename(f) == "SKILL.md":
            continue  # skills share set phrases; their overlap is checked by description below
        for n, s in units(read(f)):
            t = norm(s)
            if len(t) >= 8:
                items.append((f, n, s, t))
    exact = defaultdict(list)
    for i, it in enumerate(items):
        exact[" ".join(it[3])].append(i)
    pairs = defaultdict(list)  # (fileA, fileB) -> [(i, j, score)]
    done = set()
    for ids in exact.values():
        for a in range(len(ids)):
            for b in range(a + 1, len(ids)):
                done.add((ids[a], ids[b]))
                key = tuple(sorted((items[ids[a]][0], items[ids[b]][0])))
                pairs[key].append((ids[a], ids[b], 1.0))
    index = defaultdict(list)
    sh = []
    for i, it in enumerate(items):
        t = it[3]
        s = {" ".join(t[k:k + 4]) for k in range(len(t) - 3)}
        sh.append(s)
        for g in s:
            index[g].append(i)
    shared = defaultdict(int)
    for g, ids in index.items():
        if 2 <= len(ids) <= 12:
            for a in range(len(ids)):
                for b in range(a + 1, len(ids)):
                    shared[(ids[a], ids[b])] += 1
    for (a, b), n in shared.items():
        if (a, b) in done:
            continue
        score = n / len(sh[a] | sh[b])
        if score >= 0.55:
            key = tuple(sorted((items[a][0], items[b][0])))
            pairs[key].append((a, b, score))
    ranked = sorted(pairs.items(), key=lambda kv: -len(kv[1]))
    total = sum(len(v) for v in pairs.values())
    p(f"\nDuplicated sentences: {total} pairs in {len(pairs)} file pairs (same or nearly the same words)." if total
      else "\nNo duplicated sentence found.")
    for (fa, fb), hits in ranked[:40]:
        where = f"`{rel(fa)}`" + (" (inside the same file)" if fa == fb else f" <-> `{rel(fb)}`")
        p(f"\n- {where}: {len(hits)} shared")
        for a, b, score in sorted(hits, key=lambda h: -h[2])[:3]:
            p(f"  - L{items[a][1]} / L{items[b][1]} ({int(score * 100)}%): {items[a][2][:150]}")
    if len(ranked) > 40:
        p(f"\n...and {len(ranked) - 40} more file pairs with fewer shared sentences.")
    # old notes
    old = []
    for f in files:
        r = rel(f)
        if r.startswith("notes" + os.sep) and os.path.basename(f) != "AGENTS.md":
            d = idle(f)
            if d >= 90:
                old.append((d, r))
    if old:
        p("\nNotes untouched for 90 days or more:")
        for d, r in sorted(old, reverse=True):
            p(f"- `{r}`: {d} days")
    # broken links
    broken = defaultdict(list)
    for f in files:
        text = read(f)
        base = os.path.dirname(f)
        for n, line in enumerate(text.split("\n"), 1):
            for m in re.finditer(r"\]\(([^)#\s]+)[^)]*\)|`((?:projects|notes|archives|scripts)/[^`\s*<>{}|$]+)`", line):
                target = m.group(1) or m.group(2)
                if re.match(r"[a-z]+:|/|#|<", target) and not target.startswith(("/Users", "/home")):
                    continue
                target = target.replace("%20", " ")
                cands = [os.path.join(base, target), os.path.join(ROOT, target), os.path.expanduser(target)]
                if not any(os.path.exists(c) for c in cands) and not re.search(r"[*<>{}]|\.\.\.", target):
                    broken[rel(f)].append(f"L{n} `{target}`")
    if broken:
        p(f"\nLinks and paths that point to nothing in the brain ({sum(len(v) for v in broken.values())}, "
          "check each one: some are paths inside another repo):")
        for f, hits in sorted(broken.items()):
            p(f"- `{f}`: " + ", ".join(hits[:4]) + (f", and {len(hits) - 4} more" if len(hits) > 4 else ""))


# ---------------------------------------------------------------- skills
def skill_dirs(top):
    top = os.path.expanduser(top)
    found = {}
    if os.path.isdir(top):
        for name in sorted(os.listdir(top)):
            path = os.path.join(top, name)
            if os.path.exists(os.path.join(path, "SKILL.md")):
                found[name] = os.path.realpath(path)
    return found


def usage(names):
    """Count the sessions of the last DAYS days where each skill was run or read (Claude Code and Codex)."""
    count, last = defaultdict(int), {}
    limit = time.time() - DAYS * 86400
    pat = re.compile(rb'"skill"\s*:\s*"([\w:.-]+)"|<command-name>/([\w:.-]+)</command-name>|skills/([\w.-]+)/SKILL\.md')
    scanned = 0
    for top in ("~/.claude/projects", "~/.codex/sessions"):
        for d, _, files in os.walk(os.path.expanduser(top)):
            for f in files:
                if not f.endswith(".jsonl"):
                    continue
                path = os.path.join(d, f)
                try:
                    mt = os.path.getmtime(path)
                    if mt < limit or os.path.getsize(path) > 200_000_000:
                        continue
                    data = open(path, "rb").read()
                except OSError:
                    continue
                scanned += 1
                hit = {(a or b or c).decode().split(":")[-1] for a, b, c in pat.findall(data)}
                for name in hit & names:
                    count[name] += 1
                    last[name] = max(last.get(name, 0), mt)
    return count, last, scanned


def skills():
    local = skill_dirs(os.path.join(ROOT, ".agents", "skills"))
    glob = {}
    for g in GLOBAL_SKILLS:
        for name, path in skill_dirs(g).items():
            if path not in local.values():
                glob.setdefault(name, path)
    p(f"\n## Skills\n\n{len(local)} skills in the brain, {len(glob)} global skills.")
    count, last, scanned = usage(set(local) | set(glob)) if USAGE else ({}, {}, 0)
    if USAGE:
        p(f"Usage = sessions of the last {DAYS} days where the skill was run or read ({scanned} sessions scanned, Claude Code and Codex).")
    meta = {}
    for scope, group in (("brain", local), ("global", glob)):
        for name, path in group.items():
            text = read(os.path.join(path, "SKILL.md"))
            meta[(scope, name)] = dict(path=path, text=text, desc=front(text, "description"), fname=front(text, "name"),
                                       lines=text.count("\n"), idle=idle(path) if scope == "brain" else None)
    flags = defaultdict(list)
    for (scope, name), m in meta.items():
        if scope != "brain":
            continue
        if name in glob:
            flags[name].append(f"same name as the global skill `{rel(glob[name])}`")
        if not m["desc"]:
            flags[name].append("no description")
        if m["fname"] and m["fname"] != name:
            flags[name].append(f"name in the file is `{m['fname']}`")
        if m["lines"] > 400:
            flags[name].append(f"{m['lines']} lines")
        if USAGE and not count.get(name):
            flags[name].append(f"not used in {DAYS} days (last changed {m['idle']} days ago)")
        link = os.path.join(ROOT, ".claude", "skills")
        if os.path.isdir(os.path.join(ROOT, ".claude")) and not os.path.exists(os.path.join(link, name, "SKILL.md")):
            flags[name].append("not visible in `.claude/skills`")
    # overlapping descriptions
    words = {k: set(w for w in norm(m["desc"]) if len(w) > 3) for k, m in meta.items()}
    keys = list(meta)
    overlap = []
    for a in range(len(keys)):
        for b in range(a + 1, len(keys)):
            ka, kb = keys[a], keys[b]
            if "brain" not in (ka[0], kb[0]) or not words[ka] or not words[kb]:
                continue
            score = len(words[ka] & words[kb]) / len(words[ka] | words[kb])
            if score >= 0.4:
                overlap.append((score, ka, kb))
    p("\nBrain skills to look at:" if flags else "\nNo brain skill flagged.")
    for name in sorted(flags):
        p(f"- `{name}`: " + "; ".join(flags[name]))
    if overlap:
        p("\nSkills that describe the same job:")
        for score, ka, kb in sorted(overlap, reverse=True):
            p(f"- {ka[0]} `{ka[1]}` <-> {kb[0]} `{kb[1]}` ({int(score * 100)}% of the description words)")
    if ALL:
        p("\n| skill | scope | lines | sessions | \n| --- | --- | --- | --- |")
        for (scope, name), m in sorted(meta.items()):
            p(f"| `{name}` | {scope} | {m['lines']} | {count.get(name, 0)} |")
    elif USAGE:
        unused = sorted(n for n in glob if not count.get(n))
        if unused:
            p(f"\nGlobal skills not used in {DAYS} days ({len(unused)}, information only, never touched by a brain cleanup): "
              + ", ".join(unused))


# ---------------------------------------------------------------- tidy
def tidy():
    p("\n## Tidy")
    agents = read(os.path.join(ROOT, "AGENTS.md"))
    loose = [x for x in sorted(os.listdir(ROOT)) if x not in ROOT_OK and not re.search(rf"\b{re.escape(x)}/", agents)]
    p("\nAt the brain root, not listed in `AGENTS.md`: " + (", ".join(f"`{x}`" for x in loose) if loose else "nothing."))
    empty = []
    for d, dirs, files in walk(ROOT):
        if d != ROOT and not dirs and not [f for f in files if f != ".DS_Store"] and not os.listdir(d):
            empty.append(rel(d))
    if empty:
        p(f"\nEmpty folders ({len(empty)}):")
        for e in empty[:20]:
            p(f"- `{e}`")
    tmp = os.path.join(ROOT, ".tmp")
    if os.path.isdir(tmp):
        limit, n, size = time.time() - 7 * 86400, 0, 0
        for x in os.listdir(tmp):
            path = os.path.join(tmp, x)
            if os.path.getmtime(path) >= limit:
                continue
            n += 1
            if os.path.isdir(path):
                for d, _, files in os.walk(path):
                    for f in files:
                        try:
                            size += os.lstat(os.path.join(d, f)).st_size
                        except OSError:
                            pass
            else:
                size += os.path.getsize(path)
        p(f"\n`.tmp/`: {n} entries older than 7 days, {size // 1_000_000} MB.")
    dup = []
    for d, _, files in walk(os.path.join(ROOT, "projects")):
        for f in files:
            if f.endswith(".md") and re.search(r"(-final|-v\d+|report|rapport|summary|handoff)", f, re.I):
                dup.append(rel(os.path.join(d, f)))
    if dup:
        p(f"\nReport-like files (`*-final*`, `*-v2*`, report, summary, handoff) that may repeat an `About.md` ({len(dup)}):")
        for x in dup[:25]:
            p(f"- `{x}`")


if not os.path.isdir(os.path.join(ROOT, "projects")):
    sys.exit(f"No brain at {ROOT} (no projects/ folder). Pass the brain folder as the first argument.")
p(f"# Brain audit: {ROOT} ({TODAY.isoformat()})\n")
projects()
memories()
skills()
tidy()
report = "\n".join(out) + "\n"
os.makedirs(os.path.join(ROOT, ".tmp"), exist_ok=True)
open(os.path.join(ROOT, ".tmp", "cleanup-audit.md"), "w", encoding="utf-8").write(report)
print(report)
