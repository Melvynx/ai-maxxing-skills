#!/usr/bin/env bash
# Install and wire Hermes Agent with Claude Code on the VPS. Run on the VPS as the login user. Safe to rerun.
#   hermes.sh install                      install Claude Code and Hermes if missing, print their versions
#   hermes.sh claude                       check Claude Code is logged in, print its default model
#   hermes.sh model <model> [effort]       make Hermes use Claude (provider anthropic) with that model and effort, then test it
#   hermes.sh gateway                      install and start the always-on chat service (Telegram, Discord)
#   hermes.sh dashboard [port]             run the dashboard as a service on 127.0.0.1 (default 9119)
#   hermes.sh style < block                put the owner's "## Output style" block (from stdin) in Hermes's SOUL.md
#                                          and Claude Code's ~/.claude/CLAUDE.md, replacing the old one
#   hermes.sh autonomy                     Hermes acts without asking first and shows each tool it uses in the chat
#   hermes.sh skills <domain> <dir>        install cf and the tool skills of <dir> in ~/.agents/skills, read by Hermes and Claude Code
#   hermes.sh catalog                      the ai-maxxing skills that work on a server, installed or not, with what each does
#   hermes.sh add <skill|base|all>...      install those skills from the ai-maxxing package (kept up to date in ~/.cache);
#                                          base is the default pack, all is every skill of the catalog
#   hermes.sh update                       reinstall every skill this script installed, from the latest package
#   hermes.sh remove <skill>...            take out skills this script installed (moved to ~/.cache/removed-skills)
#   hermes.sh check                        one line per part: claude, hermes, model, gateway, dashboard, style, autonomy, skills
# Exit codes: 0 ok, 2 bad usage, 3 missing install, 4 unknown skill, 5 Claude Code not logged in, 6 Hermes cannot answer.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
cmd="${1:-}"

SKILLS="$HOME/.agents/skills"
# Skills this script installed carry this file; a skill without it is the owner's own and is never replaced.
MARK=.setup-vps
PKG="$HOME/.cache/ai-maxxing-skills"
DOMAIN_FILE="$HOME/.config/hermes-setup/domain"
# Skills of the package that only make sense on the owner's computer (browser sign-ins, their own Chrome, setting up this server).
LOCAL_ONLY='^(connect-vps|install-skills|dev-browser|setup-.*)$'
# The default pack of Hermes: one name per line in skills/setup-vps/hermes-pack of the package.
base_pack() { sed 's/#.*//' "$PKG/skills/setup-vps/hermes-pack" 2>/dev/null | tr -s ' \t\n' ' '; }

need_hermes() { command -v hermes >/dev/null 2>&1 || { echo "Hermes is missing: run '$0 install'" >&2; exit 3; }; }
# Hermes rescans ~/.agents/skills when a conversation starts, so adding or removing a skill needs no restart
# (a restart would also cut the chat Hermes is answering from).
# Copies one skill folder into ~/.agents/skills (unless the owner has their own under that name) and links it for Claude Code.
install_skill() {
  local src="${1%/}" domain="$2" name="${3:-$(basename "${1%/}")}" dest tmp link
  dest="$SKILLS/$name"
  mkdir -p "$SKILLS" "$HOME/.claude/skills"
  if [ -e "$dest" ] && [ ! -f "$dest/$MARK" ]; then
    echo "kept=$name (the owner's own)"
  else
    tmp="$(mktemp -d "$SKILLS/.$name.XXXX")"
    cp -R "$src/." "$tmp/"
    [ -n "$domain" ] && find "$tmp" -name '*.md' -exec sed -i "s/__DOMAIN__/$domain/g" {} +
    touch "$tmp/$MARK"
    [ -e "$dest" ] && mv "$dest" "$tmp.old"
    mv "$tmp" "$dest"
    [ -e "$tmp.old" ] && rm -r "$tmp.old"
    chmod -R u=rwX,go=rX "$dest"
    echo "installed=$name"
  fi
  # Claude Code on the server reads the same folder through a link.
  link="$HOME/.claude/skills/$name"
  if [ -L "$link" ] || [ ! -e "$link" ]; then ln -sfn "$dest" "$link"; fi
}
# Clones or updates the ai-maxxing package.
pull_pkg() {
  if [ -d "$PKG/.git" ]; then git -C "$PKG" pull -q --ff-only; else mkdir -p "$(dirname "$PKG")" && git clone -q --depth 1 https://github.com/Melvynx/ai-maxxing-skills "$PKG"; fi
}
# The package folder of a skill: a skill of the package, one of the server's tool skills, or the Hermes skill
# that comes with a setup skill (the dashboard one).
pkg_dir() {
  local d
  for d in "$PKG/skills/$1" "$PKG/skills/setup-vps/server-skills/$1" "$PKG"/skills/*/hermes-skill; do
    [ -f "$d/SKILL.md" ] && [ "$(sed -n 's/^name: //p' "$d/SKILL.md" | head -1)" = "$1" ] && { echo "$d"; return; }
  done
  return 1
}
describe() { sed -n 's/^description: //p' "$1/SKILL.md" | head -1 | sed 's/\. .*/./' | cut -c1-140; }
# Replaces the "## Output style" section of a file (up to the next "## " heading) with the block in $2, keeping
# every other line. Writes through a link and keeps the file's owner and mode.
put_style() {
  local file="$1" block="$2" kept
  mkdir -p "$(dirname "$file")" && touch "$file"
  kept="$(awk '/^## Output style[[:space:]]*$/ {skip=1; next} skip && /^## / {skip=0} !skip {line[++n]=$0}
    END {while (n > 0 && line[n] ~ /^[[:space:]]*$/) n--; for (i = 1; i <= n; i++) print line[i]}' "$file")"
  { [ -n "$kept" ] && printf '%s\n\n' "$kept"; cat "$block"; } > "$file.style-new"
  cat "$file.style-new" > "$file" && rm -f "$file.style-new"
}
claude_json() { claude -p "Reply with OK" --permission-mode default --output-format json < /dev/null 2>/dev/null; }

case "$cmd" in
  install)
    command -v git >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1 \
      || { $SUDO apt-get update -qq && DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq git curl jq ca-certificates >/dev/null; }
    command -v claude >/dev/null 2>&1 || curl -fsSL https://claude.ai/install.sh | bash >/dev/null
    command -v hermes >/dev/null 2>&1 || curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash -s -- --non-interactive
    grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
    echo "claude=$(claude --version 2>/dev/null | head -1)"
    echo "hermes=$(hermes --version 2>/dev/null | head -1)"
    ;;

  claude)
    command -v claude >/dev/null 2>&1 || { echo "Claude Code is missing: run '$0 install'" >&2; exit 3; }
    out="$(claude_json || true)"
    if [ "$(printf '%s' "$out" | jq -r '.is_error == false' 2>/dev/null)" != "true" ]; then
      echo "Claude Code is not logged in on the VPS" >&2
      exit 5
    fi
    echo "claude ok: $(printf '%s' "$out" | jq -r '.result' | head -c 80)"
    # The default model is the one Claude Code picked for this answer.
    echo "default_model=$(printf '%s' "$out" | jq -r '.modelUsage | keys | map(select(test("haiku") | not)) | .[0] // empty')"
    ;;

  model)
    model="${2:-}"; effort="${3:-medium}"
    [ -n "$model" ] || { echo "usage: $0 model <model> [low|medium|high|xhigh]" >&2; exit 2; }
    command -v hermes >/dev/null 2>&1 || { echo "Hermes is missing: run '$0 install'" >&2; exit 3; }
    hermes config set model.provider anthropic >/dev/null
    hermes config set model.default "$model" >/dev/null
    hermes config set agent.reasoning_effort "$effort" >/dev/null
    if answer="$(hermes -z "Reply with exactly: OK" < /dev/null 2>&1)" && printf '%s' "$answer" | grep -q OK; then
      echo "model ok: $model, effort $effort"
    else
      echo "Hermes did not answer with $model:" >&2
      printf '%s\n' "$answer" | tail -5 >&2
      exit 6
    fi
    ;;

  gateway)
    command -v hermes >/dev/null 2>&1 || { echo "Hermes is missing: run '$0 install'" >&2; exit 3; }
    # A user service stops at logout unless linger is on.
    $SUDO loginctl enable-linger "$(id -un)" 2>/dev/null || true
    hermes gateway install < /dev/null >/dev/null 2>&1 || hermes gateway install --force < /dev/null >/dev/null
    hermes gateway restart < /dev/null >/dev/null 2>&1 || hermes gateway start < /dev/null >/dev/null
    sleep 5
    hermes gateway status < /dev/null 2>&1 | tail -15
    ;;

  dashboard)
    port="${2:-9119}"
    command -v hermes >/dev/null 2>&1 || { echo "Hermes is missing: run '$0 install'" >&2; exit 3; }
    unit=/etc/systemd/system/hermes-dashboard.service
    if [ -f "$unit" ] && ! grep -q "Managed by hermes.sh" "$unit"; then
      echo "a hermes-dashboard service already exists and was not made by this script: keeping it" >&2
    else
      $SUDO tee "$unit" >/dev/null <<EOF
# Managed by hermes.sh
[Unit]
Description=Hermes dashboard (local only, published by expose.sh)
After=network-online.target

[Service]
User=$(id -un)
Environment=HOME=$HOME
ExecStart=$(command -v hermes) dashboard --host 127.0.0.1 --port $port --no-open
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
      $SUDO systemctl daemon-reload
      $SUDO systemctl enable hermes-dashboard >/dev/null 2>&1
      $SUDO systemctl restart hermes-dashboard
    fi
    for _ in $(seq 1 60); do
      code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)"
      [ "$code" = 200 ] && { echo "dashboard ok: http://127.0.0.1:$port"; exit 0; }
      sleep 3
    done
    echo "the dashboard did not answer on port $port: journalctl -u hermes-dashboard -n 50" >&2
    exit 6
    ;;

  style)
    need_hermes
    block="$(mktemp)"; trap 'rm -f "$block"' EXIT
    # The block without its blank lines around, then one final newline.
    awk 'NF {seen=1} seen {line[++n]=$0} END {while (n > 0 && line[n] ~ /^[[:space:]]*$/) n--; for (i = 1; i <= n; i++) print line[i]}' > "$block"
    [ "$(head -1 "$block")" = "## Output style" ] || { echo "the block must start with the line '## Output style'" >&2; exit 2; }
    [ "$(grep -c '^## ' "$block")" -eq 1 ] || { echo "the block must hold no other '## ' heading" >&2; exit 2; }
    [ "$(wc -c < "$block")" -le 4000 ] || { echo "the block is longer than 4000 characters" >&2; exit 2; }
    soul="$(dirname "$(hermes config path)")/SOUL.md"
    [ -f "$soul" ] && cp "$soul" "$soul.bak-$(date +%s)"
    # Hermes reads SOUL.md and Claude Code on the server reads ~/.claude/CLAUDE.md at the start of every conversation.
    put_style "$soul" "$block"
    put_style "$HOME/.claude/CLAUDE.md" "$block"
    echo "style ok: $soul and ~/.claude/CLAUDE.md"
    ;;

  autonomy)
    need_hermes
    cp "$(hermes config path)" "$(hermes config path).bak-$(date +%s)"
    # No "may I run this?" questions: Hermes runs every command and edits its own instruction files directly.
    hermes config set approvals.mode off >/dev/null
    hermes config set security.protected_instruction_files false >/dev/null
    # One short line in the chat for every tool Hermes uses.
    for platform in telegram discord; do hermes config set "display.platforms.$platform.tool_progress" all >/dev/null; done
    hermes gateway restart < /dev/null >/dev/null 2>&1 || true
    echo "autonomy ok: approvals $(hermes config get approvals.mode | tail -1), tool lines $(hermes config get display.platforms.telegram.tool_progress | tail -1)"
    ;;

  skills)
    domain="${2:-}"; dir="${3:-}"
    [ -n "$domain" ] && [ -d "$dir" ] || { echo "usage: $0 skills <domain> <folder of skills>" >&2; exit 2; }
    need_hermes
    # The cf CLI needs Node 22.23+ or 24.22+: the official Node 24 build, checked against its published sums.
    if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
      case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) echo "unsupported CPU $(uname -m)" >&2; exit 3 ;; esac
      command -v xz >/dev/null 2>&1 || { $SUDO apt-get update -qq && DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq xz-utils >/dev/null; }
      tmp="$(mktemp -d)"; base=https://nodejs.org/dist/latest-v24.x
      curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
      file="$(awk -v a="linux-$arch.tar.xz" '$2 ~ a"$" {print $2}' "$tmp/SHASUMS256.txt")"
      curl -fsSL "$base/$file" -o "$tmp/$file"
      (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet)
      $SUDO tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
      rm -f "$tmp/SHASUMS256.txt" "$tmp/$file" && rmdir "$tmp"
      hash -r
    fi
    command -v cf >/dev/null 2>&1 || $SUDO npm install -g --silent cf >/dev/null
    mkdir -p "$(dirname "$DOMAIN_FILE")" && echo "$domain" > "$DOMAIN_FILE"
    for src in "$dir"/*/; do
      [ -f "$src/SKILL.md" ] && install_skill "$src" "$domain"
    done
    # Hermes reads ~/.agents/skills too, next to the folders it already reads.
    dirs="$(hermes config get skills.external_dirs 2>/dev/null | sed -n 's/^ *- //p')"
    if ! printf '%s\n' "$dirs" | grep -qx '~/.agents/skills'; then
      list="$(printf '%s\n' "$dirs" '~/.agents/skills' | sed '/^$/d' | jq -R . | jq -cs .)"
      hermes config set skills.external_dirs "$list" >/dev/null
      hermes gateway restart < /dev/null >/dev/null 2>&1 || true
    fi
    echo "skills ok: cf $(cf --version 2>/dev/null | head -1), $(ls "$SKILLS" | tr '\n' ' ')"
    ;;

  catalog)
    pull_pkg
    base=" $(base_pack) "
    for src in "$PKG"/skills/*/ "$PKG"/skills/setup-vps/server-skills/*/; do
      name="$(basename "$src")"
      [ -f "$src/SKILL.md" ] && ! [[ "$name" =~ $LOCAL_ONLY ]] || continue
      if [ -f "$SKILLS/$name/$MARK" ]; then state=installed; elif [ -e "$SKILLS/$name" ]; then state=own; else state=available; fi
      [[ " $base " == *" $name "* ]] && pack=base || pack=-
      printf '%-20s %-10s %-5s %s\n' "$name" "$state" "$pack" "$(describe "$src")"
    done
    ;;

  add)
    shift
    [ $# -gt 0 ] || { echo "usage: $0 add <skill|base|all>... (see '$0 catalog')" >&2; exit 2; }
    need_hermes; pull_pkg
    domain="$(cat "$DOMAIN_FILE" 2>/dev/null || true)"; unknown=0
    names=()
    for name in "$@"; do
      case "$name" in
        base) names+=($(base_pack)) ;;
        all) for src in "$PKG"/skills/*/ "$PKG"/skills/setup-vps/server-skills/*/; do
               n="$(basename "$src")"; [ -f "$src/SKILL.md" ] && ! [[ "$n" =~ $LOCAL_ONLY ]] && names+=("$n")
             done ;;
        *) names+=("$name") ;;
      esac
    done
    for name in "${names[@]}"; do
      if [[ "$name" =~ $LOCAL_ONLY ]]; then echo "skipped=$name (runs on the owner's computer, not here)"; continue; fi
      src="$(pkg_dir "$name")" || { echo "unknown=$name (not in '$(basename "$0") catalog')" >&2; unknown=1; continue; }
      install_skill "$src" "$domain" "$name"
    done
    echo "skills ok: $(ls "$SKILLS" | tr '\n' ' ')"
    [ "$unknown" = 0 ] || exit 4
    ;;

  update)
    need_hermes; pull_pkg
    domain="$(cat "$DOMAIN_FILE" 2>/dev/null || true)"
    for dest in "$SKILLS"/*/; do
      name="$(basename "$dest")"
      [ -f "$dest/$MARK" ] || continue
      if src="$(pkg_dir "$name")"; then install_skill "$src" "$domain" "$name"; else echo "kept=$name (not in the package)"; fi
    done
    ;;

  remove)
    shift
    [ $# -gt 0 ] || { echo "usage: $0 remove <skill>..." >&2; exit 2; }
    need_hermes
    mkdir -p "$HOME/.cache/removed-skills"
    for name in "$@"; do
      dest="$SKILLS/$name"
      if [ ! -e "$dest" ]; then echo "absent=$name"; continue; fi
      if [ ! -f "$dest/$MARK" ]; then echo "kept=$name (the owner's own: not removing it)"; continue; fi
      mv "$dest" "$HOME/.cache/removed-skills/$name-$(date +%Y%m%d-%H%M%S)"
      [ -L "$HOME/.claude/skills/$name" ] && rm "$HOME/.claude/skills/$name"
      echo "removed=$name (copy in ~/.cache/removed-skills)"
    done
    ;;

  check)
    echo "claude=$(command -v claude >/dev/null && { claude_json | jq -r 'if .is_error == false then "logged in" else "not logged in" end' 2>/dev/null || echo "not logged in"; } || echo missing)"
    echo "hermes=$(hermes --version 2>/dev/null | head -1 || echo missing)"
    echo "model=$(hermes config get model.provider 2>/dev/null | tail -1) $(hermes config get model.default 2>/dev/null | tail -1) $(hermes config get agent.reasoning_effort 2>/dev/null | tail -1)"
    echo "gateway=$(systemctl --user is-active hermes-gateway 2>/dev/null || systemctl is-active hermes-gateway 2>/dev/null || echo inactive)"
    echo "dashboard=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9119/ || echo down)"
    soul="$(dirname "$(hermes config path 2>/dev/null)")/SOUL.md"
    echo "style=$(grep -q '^## Output style' "$soul" 2>/dev/null && echo set || echo "not set (run '$0 style')")"
    echo "autonomy=approvals $(hermes config get approvals.mode 2>/dev/null | tail -1), tool lines $(hermes config get display.platforms.telegram.tool_progress 2>/dev/null | tail -1)"
    echo "skills=$(ls "$SKILLS" 2>/dev/null | tr '\n' ' ')"
    ;;

  *)
    sed -n '2,18p' "$0" >&2
    exit 2
    ;;
esac
