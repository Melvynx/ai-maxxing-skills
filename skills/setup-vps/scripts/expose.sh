#!/usr/bin/env bash
# Put pages of the VPS online behind one gate: Cloudflare Tunnel -> Caddy -> sign-in gate (gate.py) -> the app.
# Everyone reaches the sign-in page (locked after repeated failures); saved IPs skip it. Two ways to sign in:
# email + 6-digit code sent by Lumail (the default once `mail` is set, many users with roles), or one email + password.
# Run on the VPS as root (or with sudo). Needs ~/.config/cloudflare/env from import-keys.sh. Safe to rerun.
#   expose.sh install [tunnel-name]          install cloudflared, Caddy and the gate, create or reuse the tunnel, start all
#   expose.sh user add <email> [admin|member] [--invite]  let this email sign in with a code (default member);
#                                            --invite emails them the links of the sites they can open
#   expose.sh user remove <email> / user list   take someone's access away (signs them out at once) / list everyone
#   expose.sh mail "<Name> <address>"        turn on sign-in codes: Lumail key on stdin, sends a test email to the first
#                                            admin and only saves the key if it arrived. `mail off` goes back to password
#   expose.sh login <email> [--stdin]        password sign-in instead: generate and print a password, or read it from stdin
#   expose.sh allow <ip> / deny <ip>         save or forget an IP that skips the sign-in (IPv6 counts as its /64)
#   expose.sh unlock                         clear the failed sign-in counters and locks
#   expose.sh add <hostname> <port> [--as-local] [--admins]  publish http://127.0.0.1:<port> at https://<hostname>
#   expose.sh remove <hostname>              take a hostname offline (tunnel route, DNS record, Caddy site)
#   expose.sh status                         tunnel, gate, users, every hostname, and any route that skips the gate
# --as-local sends Host and Origin as 127.0.0.1:<port>, for apps that only answer to localhost (the Hermes dashboard).
# --admins keeps the site for admins: members who sign in get "restricted access". The app behind receives the
# signed-in email and role in the X-Gate-User and X-Gate-Role headers (a saved IP counts as admin, with no email).
# gate.py (and its font geist.woff2) must sit next to this script or in /usr/local/lib/vps-gate.
# Exit codes: 0 ok, 2 bad usage, 3 missing setup, 4 DNS name already used by something else, 5 Cloudflare or Lumail error.
set -euo pipefail

STATE=/etc/vps-expose
CADDY_DIR=/etc/caddy
GATE_PORT=8080
GATE_AUTH_PORT=9180
GATE_DATA=/var/lib/vps-gate
GATE_LIB=/usr/local/lib/vps-gate
API=https://api.cloudflare.com/client/v4

[ "$(id -u)" -eq 0 ] || { echo "run as root: sudo $0 $*" >&2; exit 2; }
cmd="${1:-}"

load_cf() {
  local home env
  home="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)"
  env="${CLOUDFLARE_ENV_FILE:-$home/.config/cloudflare/env}"
  [ -f "$env" ] || { echo "no Cloudflare token on the VPS ($env): run import-keys.sh cloudflare from the Mac" >&2; exit 3; }
  # shellcheck disable=SC1090
  . "$env"
  [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || { echo "token or account missing in $env" >&2; exit 3; }
}

cfapi() { # method path [json-body]
  local out
  out="$(curl -sS -X "$1" "$API$2" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" ${3:+--data "$3"})"
  if [ "$(printf '%s' "$out" | jq -r '.success')" != "true" ]; then
    echo "Cloudflare refused $1 $2: $(printf '%s' "$out" | jq -c '.errors')" >&2
    exit 5
  fi
  printf '%s' "$out"
}

tunnel_id() {
  [ -s "$STATE/tunnel_id" ] || { echo "no tunnel yet: run '$0 install' first" >&2; exit 3; }
  cat "$STATE/tunnel_id"
}

zone_id_for() { # hostname -> id of the Cloudflare domain that holds it
  local name="$1" id
  while [[ "$name" == *.* ]]; do
    id="$(cfapi GET "/zones?name=$name" | jq -r '.result[0].id // empty')"
    [ -n "$id" ] && { echo "$id"; return; }
    name="${name#*.}"
  done
  echo "no Cloudflare domain holds $1: add the domain to Cloudflare first" >&2
  exit 3
}

apt_quiet() { DEBIAN_FRONTEND=noninteractive apt-get "$@" -y -qq -o Dpkg::Options::=--force-confold >/dev/null; }

write_caddyfile() {
  mkdir -p "$CADDY_DIR/sites" "$CADDY_DIR/gate"
  cat > "$CADDY_DIR/Caddyfile" <<EOF
# Managed by expose.sh. Every hostname of the tunnel lands here and goes through the gate.
{
	admin localhost:2019
	auto_https off
	default_bind 127.0.0.1
	servers {
		trusted_proxies static 127.0.0.1/32 ::1/128
		client_ip_headers CF-Connecting-IP
	}
}

import $CADDY_DIR/gate/gate.caddy

http://:$GATE_PORT {
	respond "Not found" 404
}

import $CADDY_DIR/sites/*.caddy
EOF
  write_gate
}

gate_snippet() { # name verify-uri
  cat <<EOF
($1) {
	@gate_page path /.gate/*
	handle @gate_page {
		reverse_proxy 127.0.0.1:$GATE_AUTH_PORT {
			header_up X-Gate-IP {client_ip}
		}
	}
	@gate_app not path /.gate/*
	forward_auth @gate_app 127.0.0.1:$GATE_AUTH_PORT {
		uri $2
		header_up X-Gate-IP {client_ip}
		# Who is signed in, for the app. Caddy first deletes any X-Gate-* header the visitor sent.
		copy_headers X-Gate-User X-Gate-Role
	}
}
EOF
}

# The gate: /.gate/* is the sign-in page, every other request asks gate.py first (saved IP or session cookie).
# gate lets every signed-in user through, gate_admin only admins.
write_gate() {
  mkdir -p "$CADDY_DIR/gate"
  { gate_snippet gate /.gate/verify; echo; gate_snippet gate_admin "/.gate/verify?need=admin"; } > "$CADDY_DIR/gate/gate.caddy"
  # Caddy runs as its own user: let it read the gate, nobody else.
  if getent group caddy >/dev/null 2>&1; then
    chown -R root:caddy "$CADDY_DIR/gate"
    chmod 750 "$CADDY_DIR/gate"
    chmod 640 "$CADDY_DIR/gate"/*
  fi
}

install_gate() {
  local src font
  for src in "$(dirname "$(readlink -f "$0")")/gate.py" "$GATE_LIB/gate.py"; do [ -f "$src" ] && break; done
  [ -f "$src" ] || { echo "gate.py not found next to $0 or in $GATE_LIB" >&2; exit 3; }
  mkdir -p "$GATE_LIB"
  [ "$src" -ef "$GATE_LIB/gate.py" ] || install -m 755 "$src" "$GATE_LIB/gate.py"
  font="$(dirname "$src")/geist.woff2"
  [ ! -f "$font" ] || [ "$font" -ef "$GATE_LIB/geist.woff2" ] || install -m 644 "$font" "$GATE_LIB/geist.woff2"
  id vps-gate >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin vps-gate
  mkdir -p "$GATE_DATA"
  # Older installs kept the login and the IPs next to the Caddy snippet: move them over once.
  for f in login ips; do
    if [ -s "$CADDY_DIR/gate/$f" ] && [ ! -s "$GATE_DATA/$f" ]; then
      mkdir -p "$STATE/removed"
      cp "$CADDY_DIR/gate/$f" "$GATE_DATA/$f" && mv "$CADDY_DIR/gate/$f" "$STATE/removed/gate-$f.$(date +%s)"
    fi
  done
  touch "$GATE_DATA/ips"
  chown -R vps-gate:vps-gate "$GATE_DATA"
  chmod 700 "$GATE_DATA"
  cat > /etc/systemd/system/vps-gate.service <<EOF
[Unit]
Description=Sign-in gate for expose.sh (127.0.0.1:$GATE_AUTH_PORT)
After=network-online.target

[Service]
User=vps-gate
Environment=GATE_DATA=$GATE_DATA GATE_PORT=$GATE_AUTH_PORT
ExecStart=/usr/bin/python3 $GATE_LIB/gate.py
Restart=always
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$GATE_DATA

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable vps-gate >/dev/null 2>&1
  systemctl restart vps-gate
  for _ in $(seq 1 20); do
    curl -s -o /dev/null "http://127.0.0.1:$GATE_AUTH_PORT/" && return
    sleep 0.5
  done
  echo "the gate did not start: journalctl -u vps-gate -n 30" >&2
  exit 3
}

gate_file() { # name: write stdin into a gate data file, readable by the gate only
  cat > "$GATE_DATA/$1.tmp"
  chown vps-gate:vps-gate "$GATE_DATA/$1.tmp"
  chmod 600 "$GATE_DATA/$1.tmp"
  mv "$GATE_DATA/$1.tmp" "$GATE_DATA/$1"
}

gate_py() { # run a gate.py command (sends one email) with the gate's data
  GATE_DATA="$GATE_DATA" GATE_LANG="${GATE_LANG:-fr}" python3 "$GATE_LIB/gate.py" "$@"
}

valid_email() {
  [[ "$1" =~ ^[^@[:space:]\<\>\"\']+@[^@[:space:]\<\>\"\']+\.[^@[:space:]\<\>\"\']+$ ]] || { echo "not an email address: $1" >&2; exit 2; }
}

first_admin() { awk '$2 == "admin" { print $1; exit }' "$GATE_DATA/users" 2>/dev/null; }

sites_for() { # role -> https URL of every site that role can open
  local f
  for f in "$CADDY_DIR"/sites/*.caddy; do
    [ -e "$f" ] || continue
    if [ "$1" = admin ] || ! grep -q "import gate_admin" "$f"; then echo "https://$(basename "$f" .caddy)"; fi
  done
}

reload_caddy() {
  caddy validate --config "$CADDY_DIR/Caddyfile" --adapter caddyfile >/dev/null 2>&1 \
    || { caddy validate --config "$CADDY_DIR/Caddyfile" --adapter caddyfile >&2; exit 3; }
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
}

set_ingress() { # hostname add|remove
  local id config
  id="$(tunnel_id)"
  config="$(cfapi GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$id/configurations" | jq -c '.result.config // {}')"
  config="$(printf '%s' "$config" | jq -c --arg h "$1" --arg mode "$2" --arg svc "http://localhost:$GATE_PORT" '
    (.ingress // []) as $old
    | ([$old[] | select(.hostname != null and .hostname != $h)]
       + (if $mode == "add" then [{hostname: $h, service: $svc}] else [] end)) as $rules
    | ([$old[] | select(.hostname == null)] | last // {service: "http_status:404"}) as $catch
    | .ingress = ($rules + [$catch])')"
  cfapi PUT "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$id/configurations" "$(jq -cn --argjson c "$config" '{config: $c}')" >/dev/null
}

normalize_ip() { # IP or CIDR -> network; a single IPv6 address counts as its /64
  [ "$1" = any ] && { echo "'any' is gone: every address already reaches the sign-in page" >&2; exit 2; }
  python3 - "$1" <<'PY' 2>/dev/null || { echo "not an IP address: $1" >&2; exit 2; }
import ipaddress, sys
v = sys.argv[1]
if "/" not in v:
    v += "/32" if ipaddress.ip_address(v).version == 4 else "/64"
print(ipaddress.ip_network(v, strict=False))
PY
}

case "$cmd" in
  install)
    name="${2:-$(hostname -s)-vps}"
    load_cf
    mkdir -p "$STATE" && chmod 700 "$STATE"
    command -v jq >/dev/null 2>&1 && command -v gpg >/dev/null 2>&1 && python3 -c 'import bcrypt' 2>/dev/null \
      || { apt-get update -qq; apt_quiet install curl jq gnupg ca-certificates python3 python3-bcrypt; }
    install_gate
    if ! command -v cloudflared >/dev/null 2>&1; then
      mkdir -p --mode=0755 /usr/share/keyrings
      curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
      echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
      apt-get update -qq && apt_quiet install cloudflared
    fi
    if ! command -v caddy >/dev/null 2>&1; then
      # Write the Caddyfile first so Caddy never starts on port 80, where another proxy may already listen.
      write_caddyfile
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
      chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq && apt_quiet install caddy
    fi
    grep -q "Managed by expose.sh" "$CADDY_DIR/Caddyfile" 2>/dev/null || {
      [ -f "$CADDY_DIR/Caddyfile" ] && cp "$CADDY_DIR/Caddyfile" "$CADDY_DIR/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)"
      write_caddyfile
    }
    write_gate
    systemctl enable --now caddy >/dev/null 2>&1
    reload_caddy
    if [ ! -s "$STATE/tunnel_id" ]; then
      id="$(cfapi GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel?name=$name&is_deleted=false" | jq -r '.result[0].id // empty')"
      [ -z "$id" ] && id="$(cfapi POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel" "$(jq -cn --arg n "$name" '{name: $n, config_src: "cloudflare"}')" | jq -r '.result.id')"
      echo "$id" > "$STATE/tunnel_id"
    fi
    id="$(tunnel_id)"
    # Own unit with a token file: never clashes with a cloudflared service that already runs another tunnel.
    cfapi GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$id/token" | jq -r '.result' > "$STATE/tunnel.token"
    chmod 600 "$STATE/tunnel.token"
    cat > /etc/systemd/system/vps-tunnel.service <<EOF
[Unit]
Description=Cloudflare Tunnel for expose.sh
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$(command -v cloudflared) --no-autoupdate tunnel run --token-file $STATE/tunnel.token
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable vps-tunnel >/dev/null 2>&1
    systemctl restart vps-tunnel
    [ -n "$(cfapi GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$id/configurations" | jq -r '.result.config.ingress // empty')" ] || set_ingress "_none_" remove
    echo "install ok: tunnel $name ($id), Caddy on 127.0.0.1:$GATE_PORT, sign-in gate on 127.0.0.1:$GATE_AUTH_PORT"
    ;;

  user)
    [ -d "$GATE_DATA" ] || { echo "run '$0 install' first" >&2; exit 3; }
    touch "$GATE_DATA/users"
    email="$(printf '%s' "${3:-}" | tr '[:upper:]' '[:lower:]')"
    case "${2:-}" in
      add)
        role=member; invite=0
        for arg in "${@:4}"; do
          case "$arg" in
            admin|member) role="$arg" ;;
            --invite) invite=1 ;;
            *) echo "usage: $0 user add <email> [admin|member] [--invite]" >&2; exit 2 ;;
          esac
        done
        valid_email "$email"
        { awk -v e="$email" '$1 != e' "$GATE_DATA/users"; echo "$email $role"; } | gate_file users
        echo "user ok: $email ($role)"
        if [ "$invite" -eq 1 ]; then
          [ -s "$GATE_DATA/lumail" ] || { echo "no invite sent: sign-in codes are off (run '$0 mail' first)" >&2; exit 3; }
          urls="$(sites_for "$role")"
          [ -n "$urls" ] || { echo "no invite sent: no site is online yet" >&2; exit 3; }
          # shellcheck disable=SC2086
          gate_py invite "$email" $urls || exit 5
        fi
        ;;
      remove)
        valid_email "$email"
        grep -q "^$email " "$GATE_DATA/users" || { echo "$email has no access" >&2; exit 2; }
        if [ -s "$GATE_DATA/lumail" ] && [ "$(awk -v e="$email" '$2 == "admin" && $1 != e' "$GATE_DATA/users" | wc -l)" -eq 0 ] \
          && grep -q "^$email admin" "$GATE_DATA/users"; then
          echo "$email is the last admin: add another admin first, or nobody can manage the sign-in" >&2; exit 2
        fi
        awk -v e="$email" '$1 != e' "$GATE_DATA/users" | gate_file users
        echo "user ok: $email removed and signed out"
        ;;
      list)
        sed 's/#.*//; /^[[:space:]]*$/d' "$GATE_DATA/users"
        ;;
      *) echo "usage: $0 user add <email> [admin|member] [--invite] | user remove <email> | user list" >&2; exit 2 ;;
    esac
    ;;

  mail)
    sender="${2:-}"
    [ -d "$GATE_DATA" ] || { echo "run '$0 install' first" >&2; exit 3; }
    if [ "$sender" = off ]; then
      [ -s "$GATE_DATA/login" ] || { echo "set a password first ('$0 login <email>'), or nobody could sign in" >&2; exit 3; }
      mkdir -p "$STATE/removed"; [ -f "$GATE_DATA/lumail" ] && mv "$GATE_DATA/lumail" "$STATE/removed/lumail.$(date +%s)"
      echo "mail ok: sign-in codes off, back to the password"
      exit 0
    fi
    [[ "$sender" == *"<"*"@"*">" ]] || { echo "usage: $0 mail \"Name <address@your-domain>\" (Lumail key on stdin)" >&2; exit 2; }
    admin="$(first_admin)"
    [ -n "$admin" ] || { echo "add an admin first: $0 user add <email> admin" >&2; exit 3; }
    if [ -t 0 ]; then IFS= read -rsp "Lumail key: " key; echo >&2; else IFS= read -r key; fi
    [[ "$key" =~ ^[A-Za-z0-9_-]{16,}$ ]] || { echo "this does not look like a Lumail key" >&2; exit 2; }
    # Send a real email before saving anything: a key or sender Lumail refuses never locks anyone out.
    printf '%s\n' "$key" | gate_py test-mail "$sender" "$admin" || { echo "nothing changed: fix the key or the sender, then rerun" >&2; exit 5; }
    printf 'key=%s\nfrom=%s\n' "$key" "$sender" | gate_file lumail
    echo "mail ok: sign-in codes on, test email sent to $admin (everyone signs in again once)"
    ;;

  login)
    user="${2:-}"
    [ -n "$user" ] || { echo "usage: $0 login <email>" >&2; exit 2; }
    command -v caddy >/dev/null 2>&1 && [ -d "$GATE_DATA" ] || { echo "run '$0 install' first" >&2; exit 3; }
    if [ "${3:-}" = "--stdin" ]; then
      if [ -t 0 ]; then IFS= read -rsp "Password (12+ characters): " password; echo >&2; else IFS= read -r password; fi
      generated=0
    else
      password="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
      generated=1
    fi
    [ "${#password}" -ge 12 ] || { echo "the password needs at least 12 characters" >&2; exit 2; }
    hash="$(printf '%s\n' "$password" | caddy hash-password)"
    # A new password signs every open session out.
    printf '%s %s\n' "$user" "$hash" | gate_file login
    echo "login ok: $user"
    [ "$generated" -eq 1 ] && echo "password: $password"
    ;;

  allow|deny)
    [ -n "${2:-}" ] || { echo "usage: $0 $cmd <ip>" >&2; exit 2; }
    [ -d "$GATE_DATA" ] || { echo "run '$0 install' first" >&2; exit 3; }
    ip="$(normalize_ip "$2")"
    { awk -v ip="$ip" '$1 != ip' "$GATE_DATA/ips"
      if [ "$cmd" = allow ]; then echo "$ip # added with expose allow $(date +%Y-%m-%d)"; fi; } | gate_file ips
    echo "$cmd ok: saved IPs are now $(sed 's/[[:space:]]*#.*//' "$GATE_DATA/ips" | tr '\n' ' ')"
    ;;

  unlock)
    echo '{}' | gate_file state.json
    systemctl restart vps-gate
    echo "unlock ok: failed sign-ins cleared"
    ;;

  add)
    host="${2:-}"; port="${3:-}"; as_local=""; snippet=gate
    for arg in "${@:4}"; do
      case "$arg" in
        --as-local) as_local="$arg" ;;
        --admins) snippet=gate_admin ;;
        *) host="" ;;
      esac
    done
    [ -n "$host" ] && [[ "$port" =~ ^[0-9]+$ ]] || { echo "usage: $0 add <hostname> <port> [--as-local] [--admins]" >&2; exit 2; }
    load_cf
    id="$(tunnel_id)"
    zone="$(zone_id_for "$host")"
    target="$id.cfargotunnel.com"
    current="$(cfapi GET "/zones/$zone/dns_records?name=$host" | jq -r '.result[0] | select(.) | "\(.type) \(.content)"')"
    if [ -z "$current" ]; then
      cfapi POST "/zones/$zone/dns_records" "$(jq -cn --arg n "$host" --arg c "$target" '{type: "CNAME", name: $n, content: $c, proxied: true}')" >/dev/null
    elif [ "$current" != "CNAME $target" ]; then
      echo "$host already points to $current: pick another name or ask the user before replacing it" >&2
      exit 4
    fi
    {
      echo "http://$host:$GATE_PORT {"
      echo "	import $snippet"
      if [ "$as_local" = "--as-local" ]; then
        # The app only sees Origin 127.0.0.1 below, so it cannot spot another site's request (a saved IP passes
        # the gate without a cookie): refuse any request whose Origin is not this page, WebSockets included.
        echo "	@cross_site {"
        echo "		header Origin *"
        echo "		not header Origin https://$host"
        echo "	}"
        echo "	respond @cross_site \"Cross-site request refused\" 403"
      fi
      echo "	reverse_proxy 127.0.0.1:$port {"
      if [ "$as_local" = "--as-local" ]; then
        echo "		header_up Host 127.0.0.1:$port"
        echo "		header_up Origin http://127.0.0.1:$port"
      fi
      echo "	}"
      echo "}"
    } > "$CADDY_DIR/sites/$host.caddy"
    reload_caddy
    set_ingress "$host" add
    echo "add ok: https://$host -> gate$([ "$snippet" = gate_admin ] && echo " (admins only)") -> 127.0.0.1:$port"
    ;;

  remove)
    host="${2:-}"
    [ -n "$host" ] || { echo "usage: $0 remove <hostname>" >&2; exit 2; }
    load_cf
    id="$(tunnel_id)"
    set_ingress "$host" remove
    zone="$(zone_id_for "$host")"
    record="$(cfapi GET "/zones/$zone/dns_records?name=$host" | jq -r --arg c "$id.cfargotunnel.com" '.result[] | select(.content == $c) | .id')"
    [ -n "$record" ] && cfapi DELETE "/zones/$zone/dns_records/$record" >/dev/null
    trash_dir="$STATE/removed"; mkdir -p "$trash_dir"
    [ -f "$CADDY_DIR/sites/$host.caddy" ] && mv "$CADDY_DIR/sites/$host.caddy" "$trash_dir/$host.caddy.$(date +%s)"
    reload_caddy
    echo "remove ok: $host is offline"
    ;;

  status)
    load_cf
    id="$(tunnel_id)"
    echo "tunnel=$id ($(systemctl is-active vps-tunnel))"
    echo "caddy=$(systemctl is-active caddy)"
    echo "gate=$(systemctl is-active vps-gate)"
    if [ -s "$GATE_DATA/lumail" ]; then
      echo "sign_in=code from=$(sed -n 's/^from=//p' "$GATE_DATA/lumail")"
    else
      echo "sign_in=password login=$([ -s "$GATE_DATA/login" ] && cut -d' ' -f1 "$GATE_DATA/login" || echo none)"
    fi
    echo "users=$(sed 's/#.*//; /^[[:space:]]*$/d' "$GATE_DATA/users" 2>/dev/null | awk '{ printf "%s%s(%s)", (NR > 1 ? " " : ""), $1, $2 }')"
    echo "saved_ips=$(sed 's/[[:space:]]*#.*//' "$GATE_DATA/ips" 2>/dev/null | tr '\n' ' ')"
    echo "locked_ips=$(jq -r --argjson now "$(date +%s)" '[.ips // {} | to_entries[] | select(.value.until > $now) | .key] | join(" ")' "$GATE_DATA/state.json" 2>/dev/null)"
    cfapi GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$id/configurations" \
      | jq -r --arg svc "http://localhost:$GATE_PORT" '.result.config.ingress[]? | select(.hostname) | if .service == $svc then "site=\(.hostname)" else "UNPROTECTED=\(.hostname) -> \(.service)" end' \
      | while IFS= read -r line; do
          if [[ "$line" == site=* ]] && grep -q "import gate_admin" "$CADDY_DIR/sites/${line#site=}.caddy" 2>/dev/null; then line="$line admins-only"; fi
          echo "$line"
        done
    for f in "$CADDY_DIR"/sites/*.caddy; do
      [ -e "$f" ] || continue
      grep -q "import gate" "$f" || echo "UNPROTECTED_CADDY=$(basename "$f" .caddy)"
    done
    ;;

  *)
    sed -n '2,23p' "$0" >&2
    exit 2
    ;;
esac
