#!/usr/bin/env bash
# Install and wire Hermes Agent with Claude Code on the VPS. Run on the VPS as the login user. Safe to rerun.
#   hermes.sh install                      install Claude Code and Hermes if missing, print their versions
#   hermes.sh claude                       check Claude Code is logged in, print its default model
#   hermes.sh model <model> [effort]       make Hermes use Claude (provider anthropic) with that model and effort, then test it
#   hermes.sh gateway                      install and start the always-on chat service (Telegram, Discord)
#   hermes.sh dashboard [port]             run the dashboard as a service on 127.0.0.1 (default 9119)
#   hermes.sh check                        one line per part: claude, hermes, model, gateway, dashboard
# Exit codes: 0 ok, 2 bad usage, 3 missing install, 5 Claude Code not logged in, 6 Hermes cannot answer.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
cmd="${1:-}"

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

  check)
    echo "claude=$(command -v claude >/dev/null && { claude_json | jq -r 'if .is_error == false then "logged in" else "not logged in" end' 2>/dev/null || echo "not logged in"; } || echo missing)"
    echo "hermes=$(hermes --version 2>/dev/null | head -1 || echo missing)"
    echo "model=$(hermes config get model.provider 2>/dev/null | tail -1) $(hermes config get model.default 2>/dev/null | tail -1) $(hermes config get agent.reasoning_effort 2>/dev/null | tail -1)"
    echo "gateway=$(systemctl --user is-active hermes-gateway 2>/dev/null || systemctl is-active hermes-gateway 2>/dev/null || echo inactive)"
    echo "dashboard=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9119/ || echo down)"
    ;;

  *)
    sed -n '2,9p' "$0" >&2
    exit 2
    ;;
esac
