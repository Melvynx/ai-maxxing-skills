#!/usr/bin/env python3
"""Scan <brain>/projects, write <brain>/.tmp/cleanup-review.html and open it.

Usage: python3 review.py [brain folder]. Without it, the brain is the path in the
`## Brain` section of the global rules, else ~/brain.
"""
import html, os, pathlib, re, subprocess, sys, webbrowser
from datetime import date, datetime

def brain_root():
    if len(sys.argv) > 1:
        return os.path.abspath(os.path.expanduser(sys.argv[1]))
    for rules in ("~/.agents/AGENTS.md", "~/.claude/CLAUDE.md"):
        p = os.path.expanduser(rules)
        if os.path.exists(p):
            m = re.search(r"^## Brain\s*$(.*?)(?=^## |\Z)", open(p, encoding="utf-8").read(), re.M | re.S)
            path = m and re.search(r"`([^`]+)`", m.group(1))
            if path:
                return os.path.expanduser(path.group(1))
    return os.path.expanduser("~/brain")


ROOT = brain_root()
OUT = os.path.join(ROOT, ".tmp", "cleanup-review.html")
SKIP = {".DS_Store"}


def git_last(folder):
    r = subprocess.run(["git", "-C", ROOT, "log", "-1", "--format=%cs", "--", folder], capture_output=True, text=True)
    return r.stdout.strip()


def newest_mtime(folder):
    best = 0
    for d, _, files in os.walk(os.path.join(ROOT, folder)):
        for f in files:
            if f not in SKIP:
                best = max(best, os.path.getmtime(os.path.join(d, f)))
    return datetime.fromtimestamp(best).date().isoformat() if best else ""


def field(text, key):
    m = re.search(rf"^{key}:\s*([^\s#]+)", text, re.M)
    return m.group(1) if m else ""


def title(text):
    m = re.search(r"^# (.+)$", text, re.M)
    return m.group(1).strip() if m else ""


def summary(text):
    body = re.split(r"^---\s*$", text, maxsplit=2, flags=re.M)[-1]
    for line in body.splitlines():
        if line.strip() and not line.startswith("#"):
            return line.strip()[:200]
    return ""


def days(d):
    return (date.today() - date.fromisoformat(d)).days if d else 9999


if not os.path.isdir(os.path.join(ROOT, "projects")):
    sys.exit(f"No projects/ folder in {ROOT}: pass the brain folder as argument.")

rows = []
for d, _, files in os.walk(os.path.join(ROOT, "projects")):
    if "About.md" not in files:
        continue
    rel = os.path.relpath(d, ROOT)
    text = open(os.path.join(d, "About.md"), encoding="utf-8").read()
    road = os.path.join(d, "Roadmap.md")
    open_tasks = len(re.findall(r"^- \[ \]", open(road, encoding="utf-8").read(), re.M)) if os.path.exists(road) else 0
    git, mt = git_last(rel), newest_mtime(rel)
    last = max(git, mt)
    idle = days(last)
    status = field(text, "status") or "none"
    if status == "done":
        rec = "archive"
    elif idle >= 60 or (status == "paused" and idle >= 30 and not open_tasks):
        rec = "archive"
    else:
        rec = "keep"
    rows.append(dict(path=rel, name=title(text) or os.path.basename(rel), status=status, updated=field(text, "updated"),
                     git=git, mtime=mt, idle=idle, tasks=open_tasks, about=summary(text), rec=rec))
rows.sort(key=lambda r: -r["idle"])

TEMPLATE = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cleanup du brain</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@400&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark;--bg:#000;--surface:#0a0a0a;--hover:#171717;--fg:#ededed;--mut:#a1a1a1;--quiet:#666;--line:#262626;--line2:#333;--ready:#45dec4;--err:#f33a4a;--warn:#f5a623}
*{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font:14px/1.5 Geist,Arial,sans-serif;margin:0;padding:56px 24px 120px;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:auto}h1{font-size:44px;font-weight:400;letter-spacing:-.045em;line-height:1;margin:0 0 14px}.sub{color:var(--mut);margin:0 0 36px;max-width:60ch}
.stats{display:flex;gap:40px;margin-bottom:32px;color:var(--mut)}.stats b{display:block;color:var(--fg);font-size:28px;font-weight:400;letter-spacing:-.03em}
.filters{display:flex;gap:8px;margin-bottom:20px;overflow-x:auto}.f{height:36px;border:1px solid var(--line);background:var(--bg);color:var(--mut);border-radius:8px;padding:0 14px;cursor:pointer;font:inherit;transition:border-color .15s,color .15s}
.f:hover{border-color:var(--line2)}.f.on{background:var(--hover);color:var(--fg);border-color:var(--line2)}
.hub{color:var(--quiet);font-size:13px;margin:32px 0 8px}
.list{border:1px solid var(--line);border-radius:8px;overflow:hidden}
.row{display:grid;grid-template-columns:minmax(200px,1fr) 100px 130px 40px 290px;align-items:center;gap:16px;min-height:64px;padding:10px 16px;border-bottom:1px solid var(--line);transition:background .15s}
.row:last-child{border-bottom:0}.row:hover{background:var(--surface)}
.nm{font-weight:500;color:var(--fg)}.pa{font-family:'Geist Mono',monospace;font-size:12px;color:var(--quiet);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st{display:flex;align-items:center;gap:8px;color:var(--mut)}.st i{width:8px;height:8px;border-radius:50%;background:var(--quiet)}.st.active i{background:var(--ready)}.st.paused i{background:var(--warn)}.st.done i{background:var(--quiet)}
.ti{font-family:'Geist Mono',monospace;font-size:13px;color:var(--mut)}.ti b{font-weight:400;color:var(--fg)}.ti.old b{color:var(--warn)}.ti.vold b{color:var(--err)}
.ta{font-family:'Geist Mono',monospace;color:var(--mut);text-align:right}
.seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}.seg button{flex:1;height:32px;border:0;border-right:1px solid var(--line);background:var(--bg);color:var(--mut);font:inherit;font-size:13px;cursor:pointer;transition:background .15s,color .15s}
.seg button:last-child{border-right:0}.seg button:hover{background:var(--hover)}.seg button.on{background:var(--fg);color:#000;font-weight:500}.seg button.on[data-v=trash]{background:var(--err);color:#fff}
.note{display:block;grid-column:1/-1;height:34px;font-size:13px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);padding:0 12px;font:inherit}.row[data-a=keep] .note{display:none}.note::placeholder,.gen::placeholder{color:var(--quiet)}.note:focus,.gen:focus{outline:0;border-color:var(--line2)}.gen{width:100%;min-height:72px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);padding:10px 12px;font:inherit;margin-bottom:24px;resize:vertical}
.foot{position:fixed;left:0;right:0;bottom:0;background:rgba(0,0,0,.9);backdrop-filter:blur(8px);border-top:1px solid var(--line);padding:14px 24px;display:flex;gap:20px;align-items:center;justify-content:space-between}
.sum{color:var(--mut);font-family:'Geist Mono',monospace;font-size:13px}.foot button{height:40px;background:var(--fg);color:#000;border:0;border-radius:8px;padding:0 20px;font:inherit;font-weight:500;cursor:pointer}.foot button:hover{background:#fff}
@media(max-width:1000px){.row{grid-template-columns:1fr auto}.row .st,.row .ta,.row .gi{display:none}.seg{grid-column:1/-1}}
</style></head><body><div class="wrap"><h1>Cleanup du brain</h1>
<p class="sub">Les projets les plus anciens en premier. La recommandation est déjà choisie : change ce que tu veux, puis copie le prompt et colle-le dans Claude.</p>
<div class="stats">__STATS__</div><textarea class="gen" id="gen" placeholder="Commentaire général pour Claude (optionnel)"></textarea><div class="filters" id="filters"></div>__BODY__</div>
<div class="foot"><span class="sum" id="sum"></span><button id="copy">Copier le prompt</button></div>
<script>
const L={keep:'Garder',archive:'Archiver',trash:'Corbeille',merge:'Fusionner',move:'Déplacer'};
const rows=[...document.querySelectorAll('.row')];
function set(c,v){c.dataset.a=v;c.querySelector('.note').placeholder=(v==='merge'||v==='move')?'Vers quel dossier ? (+ commentaire)':'Commentaire (optionnel)';c.querySelectorAll('.seg button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));sum()}
rows.forEach(c=>{c.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>set(c,b.dataset.v));set(c,c.dataset.a)});
function sum(){const n={};rows.forEach(c=>n[c.dataset.a]=(n[c.dataset.a]||0)+1);
 document.getElementById('sum').textContent=Object.keys(L).filter(k=>n[k]).map(k=>L[k]+' '+n[k]).join('  /  ');}
const fl=document.getElementById('filters');
['all',...Object.keys(L)].forEach(k=>{const b=document.createElement('button');b.className='f'+(k==='all'?' on':'');b.textContent=k==='all'?'Tous':L[k];
 b.onclick=()=>{fl.querySelectorAll('.f').forEach(x=>x.classList.remove('on'));b.classList.add('on');rows.forEach(c=>c.style.display=(k==='all'||c.dataset.a===k)?'':'none')};fl.appendChild(b)});
function build(){const g={};rows.forEach(c=>{const n=c.dataset.a==='keep'?'':c.querySelector('.note').value.trim();(g[c.dataset.a]=g[c.dataset.a]||[]).push('- '+c.dataset.path+(n?' -> '+n:''))});
 let p="/cleanup : applique mes choix du tableau de revue ("+new Date().toISOString().slice(0,10)+"). C'est mon OK, ne redemande pas.\\n";const gc=document.getElementById('gen').value.trim();if(gc)p+="\\nNote générale : "+gc+"\\n";
 for(const k of ['archive','trash','merge','move'])if(g[k])p+="\\n"+L[k]+" :\\n"+g[k].join("\\n")+"\\n";
 if(g.keep)p+="\\nGarder (mets leur 'updated' à aujourd'hui) :\\n"+g.keep.join("\\n")+"\\n";return p}
document.getElementById('copy').onclick=async e=>{const t=build();
 try{await navigator.clipboard.writeText(t)}catch(_){const a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove()}
 e.target.textContent='Copié';setTimeout(()=>e.target.textContent='Copier le prompt',1500)};
</script></body></html>"""

LABELS = [("keep", "Garder"), ("archive", "Archiver"), ("trash", "Corbeille"), ("merge", "Fusionner"), ("move", "Déplacer")]
groups = {}
for r in rows:
    parts = r["path"].split("/")
    groups.setdefault(parts[1] if len(parts) > 2 else "Racine", []).append(r)
body = ""
for hub, items in sorted(groups.items(), key=lambda kv: -max(i["idle"] for i in kv[1])):
    body += f'<div class="hub">{html.escape(hub)}</div><div class="list">'
    for r in items:
        seg = "".join(f'<button data-v="{v}">{l}</button>' for v, l in LABELS)
        cls = "vold" if r["idle"] >= 60 else "old" if r["idle"] >= 30 else ""
        idle_txt = "jamais" if r["idle"] >= 9999 else f'<b>{r["idle"]}</b> j'
        body += (f'<div class="row" data-a="{r["rec"]}" data-path="{html.escape(r["path"])}">'
                 f'<div><div class="nm">{html.escape(r["name"])}</div><div class="pa">{html.escape(r["path"])}</div></div>'
                 f'<div class="st {r["status"]}"><i></i>{r["status"]}</div>'
                 f'<div class="ti {cls}">{idle_txt}<div class="pa gi">git {r["git"] or "-"}</div></div>'
                 f'<div class="ta">{r["tasks"] or ""}</div>'
                 f'<div class="seg">{seg}</div><input class="note" placeholder="Commentaire (optionnel)"></div>')
    body += "</div>"
stats = "".join(f'<div><b>{v}</b>{k}</div>' for k, v in [
    ("projets", len(rows)), ("actifs", sum(r["status"] == "active" for r in rows)),
    ("inactifs > 30 j", sum(r["idle"] >= 30 for r in rows)), ("à archiver", sum(r["rec"] == "archive" for r in rows))])
page = TEMPLATE.replace("__STATS__", stats).replace("__BODY__", body)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w", encoding="utf-8").write(page)
print(OUT, len(rows), "projects")
webbrowser.open(pathlib.Path(OUT).as_uri())
