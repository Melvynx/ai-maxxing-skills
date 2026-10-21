#!/usr/bin/env bash
# Put pages of the VPS online behind one gate: Cloudflare Tunnel -> Caddy -> sign-in gate (gate.py) -> the app.
# Everyone reaches the sign-in page (email + password, locked after repeated failures); saved IPs skip it.
# Run on the VPS as root (or with sudo). Needs ~/.config/cloudflare/env from import-keys.sh. Safe to rerun.
#   expose.sh install [tunnel-name]          install cloudflared, Caddy and the gate, create or reuse the tunnel, start all
#   expose.sh login <email> [--stdin]        set the gate login: generate and print a password, or read the user's from stdin
#   expose.sh allow <ip> / deny <ip>         save or forget an IP that skips the sign-in (IPv6 counts as its /64)
#   expose.sh unlock                         clear the failed sign-in counters and locks
#   expose.sh add <hostname> <port> [--as-local]  publish http://127.0.0.1:<port> at https://<hostname>, behind the gate
#   expose.sh remove <hostname>              take a hostname offline (tunnel route, DNS record, Caddy site)
#   expose.sh status                         tunnel, gate, whitelist, every hostname, and any route that skips the gate
# --as-local sends Host and Origin as 127.0.0.1:<port>, for apps that only answer to localhost (the Hermes dashboard).
# gate.py must sit next to this script or in /usr/local/lib/vps-gate.
# Exit codes: 0 ok, 2 bad usage, 3 missing setup, 4 DNS name already used by something else, 5 Cloudflare API error.
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

# The gate: /.gate/* is the sign-in page, every other request asks gate.py first (saved IP or session cookie).
write_gate() {
  mkdir -p "$CADDY_DIR/gate"
  cat > "$CADDY_DIR/gate/gate.caddy" <<EOF
(gate) {
	@gate_page path /.gate/*
	handle @gate_page {
		reverse_proxy 127.0.0.1:$GATE_AUTH_PORT {
			header_up X-Gate-IP {client_ip}
		}
	}
	@gate_app not path /.gate/*
	forward_auth @gate_app 127.0.0.1:$GATE_AUTH_PORT {
		uri /.gate/verify
		header_up X-Gate-IP {client_ip}
	}
}
EOF
  # Caddy runs as its own user: let it read the gate, nobody else.
  if getent group caddy >/dev/null 2>&1; then
    chown -R root:caddy "$CADDY_DIR/gate"
    chmod 750 "$CADDY_DIR/gate"
    chmod 640 "$CADDY_DIR/gate"/*
  fi
}

install_gate() {
  local src
  for src in "$(dirname "$(readlink -f "$0")")/gate.py" "$GATE_LIB/gate.py"; do [ -f "$src" ] && break; done
  [ -f "$src" ] || { echo "gate.py not found next to $0 or in $GATE_LIB" >&2; exit 3; }
  mkdir -p "$GATE_LIB"
  [ "$src" -ef "$GATE_LIB/gate.py" ] || install -m 755 "$src" "$GATE_LIB/gate.py"
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
    host="${2:-}"; port="${3:-}"; as_local="${4:-}"
    [ -n "$host" ] && [[ "$port" =~ ^[0-9]+$ ]] || { echo "usage: $0 add <hostname> <port> [--as-local]" >&2; exit 2; }
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
      echo "	import gate"
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
    echo "add ok: https://$host -> gate -> 127.0.0.1:$port"
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
    echo "login=$([ -s "$GATE_DATA/login" ] && cut -d' ' -f1 "$GATE_DATA/login" || echo none)"
    echo "saved_ips=$(sed 's/[[:space:]]*#.*//' "$GATE_DATA/ips" 2>/dev/null | tr '\n' ' ')"
    echo "locked_ips=$(jq -r --argjson now "$(date +%s)" '[.ips // {} | to_entries[] | select(.value.until > $now) | .key] | join(" ")' "$GATE_DATA/state.json" 2>/dev/null)"
    cfapi GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/cfd_tunnel/$id/configurations" \
      | jq -r --arg svc "http://localhost:$GATE_PORT" '.result.config.ingress[]? | select(.hostname) | if .service == $svc then "site=\(.hostname)" else "UNPROTECTED=\(.hostname) -> \(.service)" end'
    for f in "$CADDY_DIR"/sites/*.caddy; do
      [ -e "$f" ] || continue
      grep -q "import gate" "$f" || echo "UNPROTECTED_CADDY=$(basename "$f" .caddy)"
    done
    ;;

  *)
    sed -n '2,14p' "$0" >&2
    exit 2
    ;;
esac
