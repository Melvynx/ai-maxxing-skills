#!/usr/bin/env bash
# Install the base skills (initialize itself included, so it can be rerun) in every folder, for Claude Code and Codex, all from the AI Maxxing kit,
# then the settings (Claude Code and Codex stop asking before each action, dangerous commands stay blocked) and the cc / cx shortcuts.
# Every skill lands once in ~/.agents/skills; ~/.claude/skills only links to it.
# Run again any time to update.
set -u

SKILLS="initialize skill-manager show-me grill-me wait-what connect-tool use-style"
# Developer skills an older version of this script installed: listed at the end, never removed here.
OLD="apex arena app-icon appstore-connect agents-manager hooks-manager rules-manager environments-manager audit-memories audit-skills audit-test"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found: install Node.js first (setup-node skill), then run this again." >&2
  exit 1
fi

failed=0
step() {
  local name="$1"; shift
  echo "==> $name"
  if "$@" < /dev/null; then
    echo "ok   $name"
  else
    echo "FAIL $name" >&2
    failed=1
  fi
}

# 1. The base skills, from the kit only
args=()
for s in $SKILLS; do args+=(-s "$s"); done
step "skills" npx -y skills add Melvynx/ai-maxxing-skills -g -a claude-code -a codex "${args[@]}" -y

# 2. Claude Code works without asking before each action, but never runs these commands or reads .env files.
#    Other keys of the settings file are kept.
claude_settings() {
  mkdir -p "$HOME/.claude"
  node -e '
    const fs = require("fs"), p = process.argv[1];
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    s.permissions = s.permissions || {};
    s.permissions.defaultMode = "bypassPermissions";
    s.permissions.deny = s.permissions.deny || [];
    for (const r of ["Bash(rm -rf *)", "Bash(sudo *)", "Bash(curl * | bash)", "Bash(wget * | bash)", "Read(./.env)", "Read(./.env.*)"])
      if (!s.permissions.deny.includes(r)) s.permissions.deny.push(r);
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  ' "$HOME/.claude/settings.json"
}
step "claude settings" claude_settings

# 3. Codex works without asking too. Only added when the user has not set these two keys already.
codex_settings() {
  local f="$HOME/.codex/config.toml" add=""
  mkdir -p "$HOME/.codex" && touch "$f"
  grep -q '^approval_policy *=' "$f" || add="${add}approval_policy = \"never\"\n"
  grep -q '^sandbox_mode *=' "$f" || add="${add}sandbox_mode = \"danger-full-access\"\n"
  [ -z "$add" ] && return
  # top-level keys must come before any [section]
  { printf "$add"; cat "$f"; } > "$f.tmp" && mv "$f.tmp" "$f"
}
step "codex settings" codex_settings

# 4. Shortcuts: cc (Claude Code without questions), ccc (same, continues the last conversation), cx and cxc (Codex).
#    Replaces the block an older run wrote (old marker name included), so it is never added twice.
shortcuts() {
  local rc block
  block='# BEGIN AI Maxxing shortcuts
# Claude Code
alias cc="claude --dangerously-skip-permissions"
alias ccc="claude --dangerously-skip-permissions -c"
# Codex
alias cx="codex"
alias cxc="codex resume --last"
# END AI Maxxing shortcuts'
  for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
    [ "$rc" = "$HOME/.zshrc" ] || [ -f "$rc" ] || continue
    touch "$rc"
    # drops the old block and the blank lines at the end, so a rerun leaves the file as it was
    awk '/^# BEGIN (AI Maxxing|AIBlueprint shell) shortcuts/ {skip=1; next} skip && /^# END (AI Maxxing|AIBlueprint shell) shortcuts/ {skip=0; next} skip {next}
      /^$/ {blank++; next} {while (blank) {print ""; blank--} print}' "$rc" > "$rc.tmp" \
      && { cat "$rc.tmp"; echo; echo "$block"; } > "$rc" && rm -f "$rc.tmp"
  done
}
step "shortcuts" shortcuts

# The status bar and the usage band come from this kit's initialize folder, downloaded once.
# KIT_SRC: a local copy of skills/initialize, to test without GitHub.
kit="${KIT_SRC:-}"
if [ -z "$kit" ]; then
  kit="$(mktemp -d)"
  trap 'rm -rf "$kit"' EXIT
  curl -fsSL https://codeload.github.com/Melvynx/ai-maxxing-skills/tar.gz/main \
    | tar -xz -C "$kit" --strip-components=3 ai-maxxing-skills-main/skills/initialize
fi

# 5. Status bar under the Claude Code prompt: folder, git branch, model, cost, context used and the 5-hour / weekly limits.
#    Runs with Bun (installed when missing). A rerun updates the code but keeps the user's statusline.config.json,
#    and a status bar the user set up themselves (another command) is never replaced.
statusline() {
  local dir="$HOME/.claude/scripts/statusline" bun
  [ -f "$kit/statusline/package.json" ] || return 1
  if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
    curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || npm install -g bun >/dev/null 2>&1 || return 1
  fi
  bun="$(command -v bun || echo "$HOME/.bun/bin/bun")"
  mkdir -p "$dir/data"
  [ -f "$dir/statusline.config.json" ] && cp "$dir/statusline.config.json" "$dir/.config.keep"
  cp -R "$kit/statusline/." "$dir/" && [ -f "$dir/.config.keep" ] && mv "$dir/.config.keep" "$dir/statusline.config.json"
  (cd "$dir" && "$bun" install --production >/dev/null 2>&1) || return 1
  node -e '
    const fs = require("fs"), [p, cmd] = process.argv.slice(1);
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    const own = s.statusLine && !String(s.statusLine.command || "").includes("scripts/statusline/src/index.ts");
    if (own) { console.log("kept your own status bar"); process.exit(0); }
    s.statusLine = { type: "command", command: cmd, padding: 0 };
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  ' "$HOME/.claude/settings.json" "$bun $dir/src/index.ts"
}
step "status bar" statusline

# 6. Usage band above the prompt in the Claude desktop app (and the terminal): context, session cost,
#    5-hour and weekly limits. A Claude Code mod in ~/.claude/mods/aiblueprint, the same folder AIBlueprint
#    uses, so it never shows twice. Its folder is added to CLAUDE_CODE_PLUGIN_DIRS, keeping the user's others.
band() {
  local dir="$HOME/.claude/mods/aiblueprint"
  [ -f "$kit/claude-mod/.claude-plugin/plugin.json" ] || return 1
  mkdir -p "$dir" && cp -R "$kit/claude-mod/." "$dir/" || return 1
  node -e '
    const fs = require("fs"), path = require("path"), os = require("os"), [p, dir] = process.argv.slice(1);
    let s = {};
    try { s = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
    s.env = s.env || {};
    s.env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1";
    const full = d => path.resolve(d.replace(/^~(?=\/|$)/, os.homedir()));
    const dirs = (s.env.CLAUDE_CODE_PLUGIN_DIRS || "").split(":").filter(Boolean);
    if (!dirs.some(d => full(d) === full(dir))) dirs.push(dir);
    s.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(":");
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  ' "$HOME/.claude/settings.json" "$dir"
}
step "usage band" band

echo
for s in $SKILLS; do
  if [ -f "$HOME/.agents/skills/$s/SKILL.md" ] && [ -f "$HOME/.claude/skills/$s/SKILL.md" ]; then
    echo "ok   /$s"
  else
    echo "MISS /$s" >&2
    failed=1
  fi
done
old=""
for s in $OLD; do [ -e "$HOME/.agents/skills/$s" ] || [ -e "$HOME/.claude/skills/$s" ] && old="$old $s"; done
[ -z "$old" ] || echo "old=${old# }"
exit "$failed"
