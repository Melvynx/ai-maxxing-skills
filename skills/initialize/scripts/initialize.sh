#!/usr/bin/env bash
# Install the base skills in every folder, for Claude Code and Codex.
# Every skill lands once in ~/.agents/skills; ~/.claude/skills only links to it.
# Run again any time to update.
set -u

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

# 1. AIBlueprint base: skills, agents, statusline, security hooks, cc/cx shortcuts
step "aiblueprint" npx -y aiblueprint-cli@latest agents setup --skip
# 2-3, 5. show-me, grill-me and connect-tool from the AI Maxxing kit
step "show-me grill-me connect-tool" npx -y skills add Melvynx/ai-maxxing-skills -g -a claude-code -a codex -s show-me -s grill-me -s connect-tool -y
# 4. wait-what by Matt Pocock
step "wait-what" npx -y skills add mattpocock/skills -g -a claude-code -a codex -s wait-what -y

echo
for s in show-me grill-me wait-what connect-tool; do
  if [ -f "$HOME/.agents/skills/$s/SKILL.md" ] && [ -f "$HOME/.claude/skills/$s/SKILL.md" ]; then
    echo "ok   /$s"
  else
    echo "MISS /$s" >&2
    failed=1
  fi
done
exit "$failed"
