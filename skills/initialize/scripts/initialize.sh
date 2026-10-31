#!/usr/bin/env bash
# Install the base skills in every folder, for Claude Code and Codex, all from the AI Maxxing kit,
# then the settings (Claude Code and Codex stop asking before each action, dangerous commands stay blocked) and the cc / cx shortcuts.
# Every skill lands once in ~/.agents/skills; ~/.claude/skills only links to it.
# Run again any time to update.
set -u

SKILLS="skill-manager show-me grill-me wait-what connect-tool use-style"
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
