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
# 2-3, 5-6. skill-manager (after AIBlueprint, so the kit one replaces its own), show-me, grill-me, connect-tool and use-style from the AI Maxxing kit
step "skill-manager show-me grill-me connect-tool use-style" npx -y skills add Melvynx/ai-maxxing-skills -g -a claude-code -a codex -s skill-manager -s show-me -s grill-me -s connect-tool -s use-style -y
# 4. wait-what by Matt Pocock
step "wait-what" npx -y skills add mattpocock/skills -g -a claude-code -a codex -s wait-what -y

echo
for s in skill-manager show-me grill-me wait-what connect-tool use-style; do
  if [ -f "$HOME/.agents/skills/$s/SKILL.md" ] && [ -f "$HOME/.claude/skills/$s/SKILL.md" ]; then
    echo "ok   /$s"
  else
    echo "MISS /$s" >&2
    failed=1
  fi
done
exit "$failed"
