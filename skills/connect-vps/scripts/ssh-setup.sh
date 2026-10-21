#!/usr/bin/env bash
# SSH setup for one VPS alias, on macOS and Linux. Safe to rerun.
#   ssh-setup.sh key [alias]                       create ~/.ssh/<alias>_ed25519 if missing, print the public key
#   ssh-setup.sh config <alias> <ip> <user> [port] add the Host block to ~/.ssh/config (backup first)
#   ssh-setup.sh test [alias]                      connect without a password and print the server facts
# Exit codes: 0 ok, 2 bad usage, 4 alias already points to another server, 5 key login refused, 6 server unreachable.
set -euo pipefail

cmd="${1:-}"
alias_name="${2:-hermes}"
key="$HOME/.ssh/${alias_name}_ed25519"
config="$HOME/.ssh/config"

ensure_ssh_dir() {
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
}

case "$cmd" in
  key)
    ensure_ssh_dir
    if [ -f "$key" ]; then
      echo "key exists: $key" >&2
    else
      ssh-keygen -q -t ed25519 -N "" -C "${alias_name}@$(hostname -s 2>/dev/null || hostname)" -f "$key"
      echo "key created: $key" >&2
    fi
    cat "$key.pub"
    ;;

  config)
    ip="${3:-}"
    user="${4:-}"
    port="${5:-22}"
    if [ -z "$ip" ] || [ -z "$user" ]; then
      echo "usage: ssh-setup.sh config <alias> <ip> <user> [port]" >&2
      exit 2
    fi
    ensure_ssh_dir
    touch "$config"
    chmod 600 "$config"
    current="$(awk -v a="$alias_name" '
      tolower($1) == "host" { inblock = 0; for (i = 2; i <= NF; i++) if ($i == a) inblock = 1; next }
      inblock && tolower($1) == "hostname" { print $2; exit }
    ' "$config")"
    if [ -n "$current" ]; then
      if [ "$current" = "$ip" ]; then
        echo "config ok: Host $alias_name already points to $ip" >&2
        exit 0
      fi
      echo "Host $alias_name already points to $current, not $ip: pick another alias or ask the user" >&2
      exit 4
    fi
    cp "$config" "$config.bak-$(date +%Y%m%d-%H%M%S)"
    {
      [ -s "$config" ] && echo ""
      echo "Host $alias_name"
      echo "  HostName $ip"
      echo "  User $user"
      echo "  Port $port"
      echo "  IdentityFile $key"
      echo "  IdentitiesOnly yes"
      echo "  ServerAliveInterval 30"
    } >> "$config"
    echo "config added: Host $alias_name -> $user@$ip:$port" >&2
    ;;

  test)
    if ! err="$(ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$alias_name" true 2>&1)"; then
      if echo "$err" | grep -q "Permission denied"; then
        echo "key login refused: the public key is not on the server yet" >&2
        exit 5
      fi
      echo "cannot reach the server: $err" >&2
      exit 6
    fi
    ssh -o BatchMode=yes "$alias_name" 'sh -s' <<'REMOTE'
. /etc/os-release 2>/dev/null || true
echo "host=$(hostname)"
echo "user=$(whoami)"
echo "os=${PRETTY_NAME:-$(uname -s)}"
echo "cpu=$(nproc 2>/dev/null || echo ?)"
echo "ram=$(free -h 2>/dev/null | awk '/^Mem/ {print $2}')"
echo "disk=$(df -h / | awk 'NR==2 {print $2 " total, " $4 " free"}')"
echo "docker=$(command -v docker >/dev/null 2>&1 && docker --version 2>/dev/null | cut -d, -f1 || echo none)"
echo "dokploy=$( (docker ps --format '{{.Names}}' 2>/dev/null || sudo -n docker ps --format '{{.Names}}' 2>/dev/null) | grep -q dokploy && echo running || echo none)"
echo "password_login=$(sshd -T 2>/dev/null | awk '/^passwordauthentication/ {print $2}' || echo unknown)"
REMOTE
    ;;

  *)
    sed -n '2,6p' "$0" >&2
    exit 2
    ;;
esac
