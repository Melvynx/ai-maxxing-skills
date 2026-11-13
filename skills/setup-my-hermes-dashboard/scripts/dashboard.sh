#!/usr/bin/env bash
# The owner's dashboard next to Hermes. Run on the VPS as the login user. Safe to rerun.
#   dashboard install-node        Node 24 LTS in /usr/local and pnpm, if missing
#   dashboard convex-key          save the Convex production deploy key (on stdin) that holds the sign-in, never printed
#   dashboard deploy              install, typecheck, test and build the code, push the sign-in backend to Convex,
#                                 then (re)start the service and check it
#   dashboard status              service state, health, local address
#   dashboard logs [lines]        the last lines of the service log
#   dashboard key [name]          new API key for dashboard-cli, saved in ~/.config/dashboard/env, never printed
#   dashboard hermes <path>       GET a Hermes API path (e.g. /api/cron/jobs) and print the JSON; the token stays hidden
#   dashboard member list | add <email> [admin|member] [--invite] | remove <email>
#                                 who may sign in (email + 6-digit code); --invite emails them the link
# The code is in ~/projects/dashboard (DASHBOARD_DIR to change it). DASHBOARD_OWNER (the owner's email, always admin),
# DASHBOARD_NAME (first name of the greeting), DASHBOARD_URL and HERMES_URL given to deploy are saved in /etc/dashboard.env, the settings of the service. Sign-in codes go out through
# Lumail with the key and sender of the gate (expose mail), or LUMAIL_API_KEY and EMAIL_FROM given to deploy; with
# none, the code only shows in the Convex logs.
# Exit codes: 0 ok, 2 bad usage, 3 missing install, 4 checks or build failed, 5 the service does not answer.
set -euo pipefail

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
DIR="${DASHBOARD_DIR:-$HOME/projects/dashboard}"
PORT=8794
ENV_FILE=/etc/dashboard.env
UNIT=/etc/systemd/system/dashboard.service
KEY_FILE="$HOME/.config/dashboard/env"
CONVEX_KEY_FILE="$HOME/.config/dashboard/convex"
GATE_LUMAIL=/var/lib/vps-gate/lumail
PNPM_VERSION=12.14.0
cmd="${1:-}"

need_node() {
  command -v node >/dev/null 2>&1 && command -v pnpm >/dev/null 2>&1 || { echo "Node or pnpm is missing: run 'dashboard install-node'" >&2; exit 3; }
}
need_code() {
  [ -f "$DIR/package.json" ] || { echo "no dashboard code in $DIR" >&2; exit 3; }
}
health() { curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/v1/health" 2>/dev/null; }
setting() { $SUDO sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -1; }

# Sets KEY=value in the settings file, keeping every other line.
set_setting() {
  local tmp; tmp="$(mktemp)"
  $SUDO cat "$ENV_FILE" | grep -v "^$1=" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  $SUDO install -m 600 -o root -g root "$tmp" "$ENV_FILE"
  rm -f "$tmp"
}

need_convex() {
  [ -s "$CONVEX_KEY_FILE" ] || { echo "no Convex deploy key: run 'dashboard convex-key' (key on stdin)" >&2; exit 3; }
}
# Runs the Convex CLI in the code folder against the production deployment; the key never reaches a command line.
convex() {
  (cd "$DIR" && CONVEX_DEPLOY_KEY="$(cat "$CONVEX_KEY_FILE")" pnpm exec convex "$@")
}
# Sets a Convex variable from stdin, so secrets stay out of the process list.
convex_env() { convex env set "$1" >/dev/null; }

case "$cmd" in
  install-node)
    if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]; then
      echo "node=$(node --version) already there"
    else
      case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) echo "unsupported CPU $(uname -m)" >&2; exit 3 ;; esac
      command -v xz >/dev/null 2>&1 || { $SUDO apt-get update -qq && DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq xz-utils >/dev/null; }
      tmp="$(mktemp -d)"
      base=https://nodejs.org/dist/latest-v24.x
      curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
      file="$(awk -v a="linux-$arch.tar.xz" '$2 ~ a"$" {print $2}' "$tmp/SHASUMS256.txt")"
      [ -n "$file" ] || { echo "no Node 24 build for linux-$arch" >&2; exit 3; }
      curl -fsSL "$base/$file" -o "$tmp/$file"
      (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet)
      $SUDO tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
      rm -f "$tmp/SHASUMS256.txt" "$tmp/$file" && rmdir "$tmp"
    fi
    [ "$(pnpm --version 2>/dev/null)" = "$PNPM_VERSION" ] || $SUDO npm install -g --silent "pnpm@$PNPM_VERSION" >/dev/null
    echo "node=$(node --version) pnpm=$(pnpm --version)"
    ;;

  convex-key)
    key="$(head -c 4096 | tr -d '[:space:]')"
    [[ "$key" == *"|"* ]] || { echo "usage: dashboard convex-key < file (the production deploy key from the Convex dashboard, Settings)" >&2; exit 2; }
    mkdir -p "$(dirname "$CONVEX_KEY_FILE")" && chmod 700 "$(dirname "$CONVEX_KEY_FILE")"
    (umask 077 && printf '%s\n' "$key" > "$CONVEX_KEY_FILE")
    echo "convex-key ok: saved in $CONVEX_KEY_FILE"
    ;;

  deploy)
    need_node; need_code; need_convex
    if ! $SUDO test -f "$ENV_FILE"; then
      tmp="$(mktemp)"
      cat > "$tmp" <<EOF
HOST=127.0.0.1
PORT=$PORT
NODE_ENV=production
DATA_DIR=$HOME/.local/share/dashboard
HERMES_API=http://127.0.0.1:9119
EOF
      $SUDO install -m 600 -o root -g root "$tmp" "$ENV_FILE"
      rm -f "$tmp"
    fi
    [ -n "${DASHBOARD_OWNER:-}" ] && set_setting DASHBOARD_OWNER "$DASHBOARD_OWNER"
    [ -n "${DASHBOARD_NAME:-}" ] && set_setting DASHBOARD_NAME "$DASHBOARD_NAME"
    [ -n "${HERMES_URL:-}" ] && set_setting HERMES_URL "$HERMES_URL"
    [ -n "${DASHBOARD_URL:-}" ] && set_setting DASHBOARD_URL "$DASHBOARD_URL"
    owner="$(setting DASHBOARD_OWNER)"; site="$(setting DASHBOARD_URL)"
    [[ "$owner" == *@* ]] && [ -n "$site" ] || { echo "deploy stopped: give DASHBOARD_OWNER=<email> and DASHBOARD_URL=https://<host> once" >&2; exit 2; }

    cd "$DIR"
    # Nothing is restarted until the new version installs, typechecks, passes its tests and builds.
    { CI=true pnpm install --frozen-lockfile --reporter=silent && pnpm typecheck && pnpm test && pnpm build; } > "$DIR/.deploy.log" 2>&1 || {
      tail -40 "$DIR/.deploy.log" >&2
      echo "deploy stopped: the version online did not change (full log in $DIR/.deploy.log)" >&2
      exit 4
    }

    # The sign-in backend: functions and schema, then its settings. Nothing changes online if the push fails.
    rm -f "$DIR/.convex-url"
    convex deploy -y --cmd-url-env-var-name CONVEX_URL --cmd 'printf %s "$CONVEX_URL" > .convex-url' >> "$DIR/.deploy.log" 2>&1 || {
      tail -20 "$DIR/.deploy.log" >&2; echo "deploy stopped: Convex refused the push" >&2; exit 4; }
    convex_url="${CONVEX_URL:-$(cat "$DIR/.convex-url")}"
    convex_site="${CONVEX_SITE_URL:-${convex_url/.convex.cloud/.convex.site}}"
    set_setting CONVEX_URL "$convex_url"
    set_setting CONVEX_SITE_URL "$convex_site"
    printf '%s' "$owner" | convex_env DASHBOARD_OWNER
    printf '%s' "$site" | convex_env SITE_URL
    # One secret for the sessions, made once: a new one would sign everyone out.
    convex env list 2>/dev/null | cut -d= -f1 | grep -qx BETTER_AUTH_SECRET || openssl rand -base64 32 | tr -d '\n' | convex_env BETTER_AUTH_SECRET
    lumail_key="${LUMAIL_API_KEY:-}"; lumail_from="${EMAIL_FROM:-}"
    if [ -z "$lumail_key" ] && $SUDO test -s "$GATE_LUMAIL"; then
      lumail_key="$($SUDO sed -n 's/^key=//p' "$GATE_LUMAIL")"; lumail_from="$($SUDO sed -n 's/^from=//p' "$GATE_LUMAIL")"
    fi
    if [ -n "$lumail_key" ] && [ -n "$lumail_from" ]; then
      printf '%s' "$lumail_key" | convex_env LUMAIL_API_KEY
      printf '%s' "$lumail_from" | convex_env EMAIL_FROM
      mail="codes by email from $lumail_from"
    else
      mail="no Lumail key: codes only show in the Convex logs"
    fi
    unset lumail_key

    # The service runs a copy of the build in .releases/, reached through the .live link: the next build rewrites
    # .output without pulling chunks from under the running server, and a failed build leaves it untouched.
    release="$DIR/.releases/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$DIR/.releases"
    cp -a "$DIR/.output" "$release"
    ln -sfn "$release" "$DIR/.live.new" && mv -Tf "$DIR/.live.new" "$DIR/.live"

    if [ -f "$UNIT" ] && ! grep -q "Managed by dashboard.sh" "$UNIT"; then
      echo "a dashboard service already exists and was not made by this script: not touching it" >&2
      exit 3
    fi
    tmp="$(mktemp)"
    cat > "$tmp" <<EOF
# Managed by dashboard.sh
[Unit]
Description=Personal dashboard (local only, published by expose)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $DIR/.live/server/index.mjs
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
    $SUDO install -m 644 "$tmp" "$UNIT"
    rm -f "$tmp"
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable --quiet dashboard.service
    $SUDO systemctl restart dashboard.service
    for _ in $(seq 1 30); do
      if out="$(health)"; then
        echo "dashboard ok on 127.0.0.1:$PORT, hermes $(printf '%s' "$out" | jq -r '.hermes'), sign-in: $mail"
        # Keeps the 3 newest builds; older ones are only build output.
        ls -1d "$DIR"/.releases/*/ 2>/dev/null | head -n -3 | xargs -r rm -rf
        exit 0
      fi
      sleep 1
    done
    $SUDO journalctl -u dashboard.service -n 30 --no-pager >&2
    echo "the dashboard service does not answer on 127.0.0.1:$PORT" >&2
    exit 5
    ;;

  status)
    echo "service=$(systemctl is-active dashboard.service 2>/dev/null || true)"
    if out="$(health)"; then echo "health=ok hermes=$(printf '%s' "$out" | jq -r '.hermes')"; else echo "health=down"; fi
    echo "url=$(setting DASHBOARD_URL) local=http://127.0.0.1:$PORT code=$DIR"
    [ -f "$KEY_FILE" ] && echo "key=$KEY_FILE" || echo "key=none (run 'dashboard key')"
    echo "convex=$(setting CONVEX_URL)$([ -s "$CONVEX_KEY_FILE" ] || echo " (no deploy key: run 'dashboard convex-key')")"
    ;;

  logs)
    $SUDO journalctl -u dashboard.service -n "${2:-50}" --no-pager
    ;;

  key)
    need_node; need_code
    name="${2:-hermes}"
    data="$(setting DATA_DIR)"
    [ -n "$data" ] || { echo "run 'dashboard deploy' first" >&2; exit 3; }
    (cd "$DIR" && DATA_DIR="$data" node scripts/new-key.mjs "$KEY_FILE" "$name" "http://127.0.0.1:$PORT")
    ;;

  hermes)
    path="${2:-}"
    [[ "$path" == /api/* ]] || { echo "usage: dashboard hermes /api/<path>" >&2; exit 2; }
    token="$(curl -fsS --max-time 5 http://127.0.0.1:9119/ | sed -n 's/.*__HERMES_SESSION_TOKEN__ *= *"\([^"]*\)".*/\1/p' | head -1)"
    [ -n "$token" ] || { echo "Hermes does not answer on 127.0.0.1:9119" >&2; exit 5; }
    # The token goes to curl through a file descriptor, never on its command line.
    curl -fsS --max-time 15 -H @<(printf 'X-Hermes-Session-Token: %s\n' "$token") "http://127.0.0.1:9119$path" | jq .
    ;;

  member)
    need_node; need_code; need_convex
    case "${2:-}" in
      list)
        convex run members:serverList | jq -r '.[] | "\(.email) \(.role)\(if .owner then " (owner)" else "" end)"'
        ;;
      add)
        email="$(printf '%s' "${3:-}" | tr '[:upper:]' '[:lower:]')"; role=member; invite=false
        for arg in "${@:4}"; do
          case "$arg" in admin|member) role="$arg" ;; --invite) invite=true ;; *) email="" ;; esac
        done
        [[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { echo "usage: dashboard member add <email> [admin|member] [--invite]" >&2; exit 2; }
        convex run members:serverAdd "$(jq -cn --arg e "$email" --arg r "$role" --argjson i "$invite" '{email: $e, role: $r, invite: $i}')" >/dev/null
        echo "member ok: $email can sign in as $role$([ "$invite" = true ] && echo ", invite sent")"
        ;;
      remove)
        [ -n "${3:-}" ] || { echo "usage: dashboard member remove <email>" >&2; exit 2; }
        convex run members:serverRemove "$(jq -cn --arg e "$3" '{email: $e}')" >/dev/null
        echo "member ok: $3 removed and signed out"
        ;;
      *) echo "usage: dashboard member list | add <email> [admin|member] [--invite] | remove <email>" >&2; exit 2 ;;
    esac
    ;;

  *)
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    [ -z "$cmd" ] || exit 2
    ;;
esac
