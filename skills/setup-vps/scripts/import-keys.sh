#!/usr/bin/env bash
# Copy the Mac's GitHub and Cloudflare access to the VPS, without printing a token. Run on the Mac. Safe to rerun.
#   import-keys.sh github [alias]      install gh on the VPS, log it in with the Mac's gh token, copy git name and email
#   import-keys.sh cloudflare [alias]  create a Cloudflare token that only works from the VPS, save it there
#   import-keys.sh hermes-env [alias]  copy the saved Cloudflare token into ~/.hermes/.env (after Hermes is installed)
# Exit codes: 0 ok, 2 bad usage, 3 missing tool or login on the Mac, 4 several Cloudflare accounts, 6 VPS unreachable.
set -euo pipefail

cmd="${1:-}"
alias_name="${2:-hermes}"
cf_env='$HOME/.config/cloudflare/env'

remote() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$alias_name" "$@"; }

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing on the Mac: $1 ($2)" >&2; exit 3; }
}

check_vps() {
  remote true 2>/dev/null || { echo "cannot reach '$alias_name': run the connect-vps skill first" >&2; exit 6; }
}

# Upsert KEY=value lines read from stdin into a file on the VPS (chmod 600), keeping every other line.
REMOTE_UPSERT='f="$1"; mkdir -p "$(dirname "$f")"; touch "$f"; chmod 600 "$f"
while IFS= read -r line; do
  [ -z "$line" ] && continue
  key="${line%%=*}"; key="${key#export }"
  grep -vE "^(export )?${key}=" "$f" > "$f.tmp" || true
  printf "%s\n" "$line" >> "$f.tmp"
  mv "$f.tmp" "$f"; chmod 600 "$f"
done'

case "$cmd" in
  github)
    need gh "run the setup-github skill first"
    gh auth status >/dev/null 2>&1 || { echo "gh is not logged in on the Mac: run the setup-github skill first" >&2; exit 3; }
    check_vps
    remote 'sh -s' <<'REMOTE'
set -e
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
if ! command -v gh >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq curl git ca-certificates >/dev/null
  $SUDO mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | $SUDO tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  $SUDO chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | $SUDO tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq gh >/dev/null
fi
command -v git >/dev/null 2>&1 || $SUDO apt-get install -y -qq git >/dev/null
REMOTE
    if remote 'gh auth status' >/dev/null 2>&1; then
      echo "github ok: gh already logged in on the VPS" >&2
    else
      gh auth token | remote 'gh auth login --with-token'
    fi
    remote 'gh auth setup-git'
    name="$(git config --global user.name || true)"
    email="$(git config --global user.email || true)"
    [ -n "$name" ] && remote "git config --global user.name $(printf '%q' "$name")"
    [ -n "$email" ] && remote "git config --global user.email $(printf '%q' "$email")"
    login="$(remote 'gh api user --jq .login')"
    echo "github ok: VPS logged in as $login, git as ${name:-?} <${email:-?}>"
    ;;

  cloudflare)
    need cf "run the setup-cloudflare skill first"
    need jq "brew install jq"
    cf auth whoami 2>/dev/null | grep -q '"authenticated": *true' || { echo "cf is not logged in on the Mac: run the setup-cloudflare skill first" >&2; exit 3; }
    check_vps
    acct="${CLOUDFLARE_ACCOUNT_ID:-}"
    if [ -z "$acct" ]; then
      accounts="$(cf accounts list | jq -r '(if type == "array" then . else .result end)[] | .id')"
      if [ "$(printf '%s\n' "$accounts" | grep -c .)" -ne 1 ]; then
        echo "several Cloudflare accounts: set CLOUDFLARE_ACCOUNT_ID (setup-cloudflare step 5) and rerun" >&2
        exit 4
      fi
      acct="$accounts"
    fi
    export CLOUDFLARE_ACCOUNT_ID="$acct"
    # Already done if the VPS has a token that Cloudflare still accepts.
    if remote ". $cf_env 2>/dev/null && curl -fsS -H \"Authorization: Bearer \$CLOUDFLARE_API_TOKEN\" https://api.cloudflare.com/client/v4/accounts/\$CLOUDFLARE_ACCOUNT_ID/tokens/verify" 2>/dev/null | grep -q '"status": *"active"'; then
      echo "cloudflare ok: the VPS already has a working token" >&2
      exit 0
    fi
    ip4="$(remote 'curl -4 -fsS --max-time 8 https://api.ipify.org' 2>/dev/null || true)"
    ip6="$(remote 'curl -6 -fsS --max-time 8 https://api6.ipify.org' 2>/dev/null || true)"
    [ -z "$ip4" ] && [ -z "$ip6" ] && { echo "cannot read the VPS public IP" >&2; exit 6; }
    ips=()
    [ -n "$ip4" ] && ips+=("$ip4/32")
    # Cloudflare checks the whole /64 an IPv6 server talks from.
    [ -n "$ip6" ] && ips+=("$(remote "python3 -c 'import ipaddress; print(ipaddress.ip_network(\"$ip6/64\", strict=False))'")")
    groups="$(cf accounts tokens permission-groups list)"
    pick() { # scope, then names
      local scope="$1"; shift
      printf '%s' "$groups" | jq -c --arg s "$scope" --args '[.[] | select(.name as $n | $ARGS.positional | index($n)) | select(.scopes | index($s)) | {id}] | unique' "$@"
    }
    account_groups="$(pick com.cloudflare.api.account "Cloudflare Tunnel Write" "Workers Scripts Write" "Account Settings Read" "Workers R2 Storage Write" "Workers KV Storage Write" "D1 Write" "Pages Write" "Access: Apps and Policies Write")"
    zone_groups="$(pick com.cloudflare.api.account.zone "Zone Read" "DNS Write" "Zone WAF Write" "Workers Routes Write" "Cache Purge" "Access: Apps and Policies Write")"
    policies="$(jq -cn --arg a "com.cloudflare.api.account.$acct" --argjson ag "$account_groups" --argjson zg "$zone_groups" '[
      {effect: "allow", resources: {($a): "*"}, permission_groups: $ag},
      {effect: "allow", resources: {($a): {"com.cloudflare.api.account.zone.*": "*"}}, permission_groups: $zg}
    ]')"
    name="vps-$alias_name"
    old_ids="$(cf accounts tokens list | jq -r --arg n "$name" '(if type == "array" then . else .result end)[] | select(.name == $n) | .id')"
    # The token goes straight from Cloudflare to the VPS through stdin, never to the screen.
    cf accounts tokens create --name "$name" --policies "$policies" --condition-request-ip-in "${ips[@]}" \
      | jq -r '(.result? // .).value' \
      | { read -r token; [ -n "$token" ] && [ "$token" != null ] || { echo "token creation failed" >&2; exit 3; }
          printf 'export CLOUDFLARE_API_TOKEN=%s\nexport CLOUDFLARE_ACCOUNT_ID=%s\n' "$token" "$acct"; } \
      | remote "sh -c '$REMOTE_UPSERT' sh $cf_env"
    # Load the file in every shell, before the "not interactive" early return of ~/.bashrc.
    remote "for rc in ~/.bashrc ~/.profile; do touch \$rc; grep -q 'config/cloudflare/env' \$rc || { printf '%s\n' '[ -f ~/.config/cloudflare/env ] && . ~/.config/cloudflare/env' | cat - \$rc > \$rc.tmp && mv \$rc.tmp \$rc; }; done"
    sleep 3
    if remote ". $cf_env && curl -fsS -H \"Authorization: Bearer \$CLOUDFLARE_API_TOKEN\" https://api.cloudflare.com/client/v4/accounts/\$CLOUDFLARE_ACCOUNT_ID/tokens/verify" | grep -q '"status": *"active"'; then
      for id in $old_ids; do cf accounts tokens delete "$id" --force >/dev/null 2>&1 || true; done
      echo "cloudflare ok: token '$name' saved on the VPS, works only from ${ips[*]}"
    else
      echo "the token was saved but Cloudflare refuses it from the VPS" >&2
      exit 3
    fi
    ;;

  hermes-env)
    check_vps
    remote ". $cf_env 2>/dev/null && [ -n \"\$CLOUDFLARE_API_TOKEN\" ] && [ -d ~/.hermes ]" \
      || { echo "run 'import-keys.sh cloudflare' and install Hermes first" >&2; exit 2; }
    remote ". $cf_env && printf 'CLOUDFLARE_API_TOKEN=%s\nCLOUDFLARE_ACCOUNT_ID=%s\n' \"\$CLOUDFLARE_API_TOKEN\" \"\$CLOUDFLARE_ACCOUNT_ID\" | sh -c '$REMOTE_UPSERT' sh \$HOME/.hermes/.env"
    echo "hermes-env ok: Cloudflare token copied into ~/.hermes/.env"
    ;;

  *)
    sed -n '2,7p' "$0" >&2
    exit 2
    ;;
esac
