#!/usr/bin/env bash
# Connect Hermes to Discord from the VPS: save the bot's access, turn on what it needs, set up its server. Safe to rerun.
#   discord.sh token                         read the bot's access from stdin (a pipe, or a hidden prompt), check it
#                                            with Discord and save it in Hermes's .env
#   discord.sh app [guild_id]                turn on the two intents Hermes needs, allow the bot's owner, print the invite link
#   discord.sh server [guild_id] [channel] [role]
#                                            in the server the bot joined: an access role given to the owner, and a
#                                            private channel (default #hermes) where the bot answers without a mention
#   discord.sh say <text>                    post <text> in that channel
#   discord.sh access list|add|remove [username|id]
#                                            who has the access role, so may talk to the agent (no restart needed)
#   discord.sh check                         one line per part: access, bot, intents, owner, server, channel, role, gateway
# Exit codes: 0 ok, 2 bad usage, 3 missing install or access, 4 needs a choice (several servers, no match),
# 5 Discord refused the access, 6 Discord refused a change.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
cmd="${1:-}"

API=https://discord.com/api/v10
# View channels, send, embed links, attach files, read history, add reactions, create public threads, send in
# threads (Hermes's recommended set), plus manage channels and manage roles for the channel and the access role.
PERMS=$(( (1<<10) | (1<<11) | (1<<14) | (1<<15) | (1<<16) | (1<<6) | (1<<35) | (1<<38) | (1<<4) | (1<<28) ))
BOT_ALLOW=$(( (1<<10) | (1<<11) | (1<<14) | (1<<15) | (1<<16) | (1<<6) | (1<<35) | (1<<38) ))
MEMBER_ALLOW=$(( (1<<10) | (1<<11) | (1<<14) | (1<<15) | (1<<16) | (1<<6) | (1<<38) ))
STATE="$HOME/.config/hermes-discord/state"

if [ -n "${HERMES_ENV_FILE:-}" ]; then
  ENV_FILE="$HERMES_ENV_FILE"
else
  config="$(hermes config path 2>/dev/null | tail -1 || true)"
  if [ -n "$config" ] && [ -d "$(dirname "$config")" ]; then ENV_FILE="$(dirname "$config")/.env"; else ENV_FILE="$HOME/.hermes/.env"; fi
fi

command -v jq >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 || { echo "jq and curl are needed: run 'hermes-setup install'" >&2; exit 3; }

# KEY=value files (Hermes's .env and this script's state): read one key, or replace it in place, mode 600.
get_kv() { [ -f "$1" ] && sed -n "s/^$2=//p" "$1" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" || true; }
set_kv() {
  local file="$1" tmp
  mkdir -p "$(dirname "$file")"; (umask 077; touch "$file")
  tmp="$(mktemp)"
  K="$2" V="$3" awk 'BEGIN {k = ENVIRON["K"]; v = ENVIRON["V"]}
    index($0, k "=") == 1 {if (!done) print k "=" v; done = 1; next} {print}
    END {if (!done) print k "=" v}' "$file" > "$tmp"
  cat "$tmp" > "$file" && rm -f "$tmp" && chmod 600 "$file"
}
# Adds an id to a comma-separated list in the .env, once.
add_to_list() {
  local current; current="$(get_kv "$ENV_FILE" "$1")"
  case ",$current," in *",$2,"*) return ;; esac
  set_kv "$ENV_FILE" "$1" "${current:+$current,}$2"
}

# The bot's access goes in a 600 header file, never on a command line.
HDR=""
trap '[ -n "$HDR" ] && rm -f "$HDR"' EXIT
auth() {
  local token="${1:-$(get_kv "$ENV_FILE" DISCORD_BOT_TOKEN)}"
  [ -n "$token" ] || { echo "no Discord access saved: run '$(basename "$0") token' first" >&2; exit 3; }
  HDR="$(mktemp)"; chmod 600 "$HDR"
  printf 'Authorization: Bot %s\n' "$token" > "$HDR"
}
# api METHOD PATH [JSON]: sets CODE and BODY. Waits and retries when Discord says to slow down.
api() {
  local out data=() try wait
  [ $# -ge 3 ] && data=(--data-binary "$3")
  for try in 1 2 3; do
    out="$(curl -sS -X "$1" -H @"$HDR" -H 'Content-Type: application/json' \
      -H 'User-Agent: DiscordBot (https://github.com/Melvynx/ai-maxxing-skills, 1)' "${data[@]}" \
      -w '\n%{http_code}' "$API$2" 2>/dev/null)" || true
    CODE="${out##*$'\n'}"; BODY="${out%$'\n'*}"
    [ "$CODE" = 429 ] && [ "$try" -lt 3 ] || return 0
    wait="$(jq -r '(.retry_after // 1) | ceil' <<<"$BODY" 2>/dev/null || echo 1)"
    sleep "$(( wait > 10 ? 10 : wait ))"
  done
}
fail() { echo "$1 (HTTP ${CODE:-none}): $(jq -r '.message // empty' <<<"$BODY" 2>/dev/null | head -c 200)" >&2; exit "${2:-6}"; }

load_app() {
  api GET /oauth2/applications/@me
  [ "$CODE" = 200 ] || fail "Discord refused to read the application" 5
  APP_ID="$(jq -r .id <<<"$BODY")"
  OWNER_ID="$(jq -r '.team.owner_user_id // .owner.id' <<<"$BODY")"
  OWNER_NAME="$(jq -r 'if .team then .team.name else .owner.username end' <<<"$BODY")"
  FLAGS="$(jq -r '.flags // 0' <<<"$BODY")"
}
# Server members (bits 14/15) and message content (18/19), verified or limited: both must be on.
intents_on() { (( (FLAGS & ((1<<14) | (1<<15))) != 0 && (FLAGS & ((1<<18) | (1<<19))) != 0 )); }

# The server the bot works in: the one given, the saved one, or the only one it joined.
pick_guild() {
  api GET /users/@me/guilds
  [ "$CODE" = 200 ] || fail "Discord refused to list the bot's servers"
  local wanted="${1:-$(get_kv "$STATE" guild)}" count
  count="$(jq length <<<"$BODY")"
  if [ -n "$wanted" ]; then
    GUILD_NAME="$(jq -r --arg id "$wanted" '.[] | select(.id == $id) | .name' <<<"$BODY")"
    [ -n "$GUILD_NAME" ] || { echo "the bot is not in server $wanted yet: open the invite link from '$(basename "$0") app $wanted'" >&2; exit 4; }
    GUILD="$wanted"
  elif [ "$count" = 1 ]; then
    GUILD="$(jq -r '.[0].id' <<<"$BODY")"; GUILD_NAME="$(jq -r '.[0].name' <<<"$BODY")"
  elif [ "$count" = 0 ]; then
    echo "the bot is in no server yet: open the invite link from '$(basename "$0") app'" >&2; exit 4
  else
    echo "the bot is in several servers, pass the one to use:" >&2
    jq -r '.[] | "guild=\(.id) \(.name)"' <<<"$BODY" >&2
    exit 4
  fi
}

# Finds a member by id, exact username or exact display name; sets MEMBER_ID and MEMBER_NAME.
find_member() {
  local who="${1#@}"
  if [[ "$who" =~ ^[0-9]{15,22}$ ]]; then
    api GET "/guilds/$GUILD/members/$who"
    [ "$CODE" = 200 ] || { echo "no member with id $who in $GUILD_NAME" >&2; exit 4; }
    BODY="[$BODY]"
  else
    api GET "/guilds/$GUILD/members/search?limit=10&query=$(jq -rn --arg q "$who" '$q | @uri')"
    [ "$CODE" = 200 ] || fail "Discord refused the member search"
    BODY="$(jq --arg q "$who" '[.[] | select((.user.username | ascii_downcase) == ($q | ascii_downcase)
      or ((.user.global_name // "") | ascii_downcase) == ($q | ascii_downcase))]' <<<"$BODY")"
  fi
  case "$(jq length <<<"$BODY")" in
    1) MEMBER_ID="$(jq -r '.[0].user.id' <<<"$BODY")"; MEMBER_NAME="$(jq -r '.[0].user.username' <<<"$BODY")" ;;
    0) echo "nobody called $who in $GUILD_NAME: they must join the server first" >&2; exit 4 ;;
    *) echo "several members match $who, pass their id:" >&2; jq -r '.[] | "\(.user.id) \(.user.username)"' <<<"$BODY" >&2; exit 4 ;;
  esac
}

gateway_state() { systemctl --user is-active hermes-gateway 2>/dev/null || systemctl is-active hermes-gateway 2>/dev/null || echo inactive; }

case "$cmd" in
  token)
    if [ -t 0 ]; then read -rsp "Discord bot access: " token; echo >&2; else IFS= read -r token || true; fi
    token="$(printf '%s' "${token:-}" | tr -d '[:space:]')"
    [ -n "$token" ] || { echo "nothing received: copy the bot's access in the Developer Portal first" >&2; exit 2; }
    [[ "$token" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] \
      || { echo "this is not a Discord bot access: reset it in the Bot tab and read it again" >&2; exit 2; }
    auth "$token"
    api GET /users/@me
    [ "$CODE" = 200 ] || fail "Discord refused this access: reset it in the Developer Portal and copy it again" 5
    set_kv "$ENV_FILE" DISCORD_BOT_TOKEN "$token"
    echo "token ok: bot $(jq -r .username <<<"$BODY") ($(jq -r .id <<<"$BODY")), saved in $ENV_FILE"
    ;;

  app)
    auth; load_app
    if ! intents_on; then
      want=$(( (1<<15) | (1<<19) ))
      api PATCH /applications/@me "{\"flags\": $(( FLAGS | want ))}"
      [ "$CODE" = 200 ] || api PATCH /applications/@me "{\"flags\": $(( (FLAGS & ((1<<13) | (1<<15) | (1<<19))) | want ))}"
      load_app
    fi
    if intents_on; then echo "intents=on"; else echo "intents=manual https://discord.com/developers/applications/$APP_ID/bot"; fi
    add_to_list DISCORD_ALLOWED_USERS "$OWNER_ID"
    set_kv "$STATE" app "$APP_ID"; set_kv "$STATE" owner "$OWNER_ID"
    echo "owner=$OWNER_NAME ($OWNER_ID) allowed"
    url="https://discord.com/oauth2/authorize?client_id=$APP_ID&scope=bot+applications.commands&permissions=$PERMS"
    [ -n "${2:-}" ] && url="$url&guild_id=$2&disable_guild_select=true"
    echo "invite=$url"
    ;;

  server)
    channel_name="${3:-hermes}"; role_name="${4:-Hermes access}"
    auth; pick_guild "${2:-}"
    owner="$(get_kv "$STATE" owner)"; [ -n "$owner" ] || { load_app; owner="$OWNER_ID"; }
    api GET /users/@me; bot_id="$(jq -r .id <<<"$BODY")"

    # The access role: the saved one if it still exists, else one with that name made by hand, else a new one.
    api GET "/guilds/$GUILD/roles"
    [ "$CODE" = 200 ] || fail "Discord refused to list the roles"
    role="$(get_kv "$STATE" role)"
    [ -n "$role" ] && [ -z "$(jq -r --arg id "$role" '.[] | select(.id == $id) | .id' <<<"$BODY")" ] && role=""
    [ -n "$role" ] || role="$(jq -r --arg n "$role_name" '[.[] | select(.name == $n and (.managed | not))][0].id // empty' <<<"$BODY")"
    if [ -z "$role" ]; then
      api POST "/guilds/$GUILD/roles" "$(jq -cn --arg n "$role_name" '{name: $n, mentionable: false, hoist: false, permissions: "0"}')"
      [ "$CODE" = 200 ] || fail "Discord refused to create the role (the bot needs Manage Roles: reinvite it with the link from 'app')"
      role="$(jq -r .id <<<"$BODY")"
    fi
    api PUT "/guilds/$GUILD/members/$owner/roles/$role"
    [ "$CODE" = 204 ] && owner_role=given || owner_role="not given (HTTP $CODE: is the owner in this server?)"

    # The channel: private to the role and the bot, the bot answers there without being mentioned.
    channel="$(get_kv "$STATE" channel)"
    api GET "/guilds/$GUILD/channels"
    [ "$CODE" = 200 ] || fail "Discord refused to list the channels"
    [ -n "$channel" ] && [ -z "$(jq -r --arg id "$channel" '.[] | select(.id == $id) | .id' <<<"$BODY")" ] && channel=""
    [ -n "$channel" ] || channel="$(jq -r --arg n "$channel_name" '[.[] | select(.type == 0 and .name == $n)][0].id // empty' <<<"$BODY")"
    if [ -z "$channel" ]; then
      api POST "/guilds/$GUILD/channels" "$(jq -cn --arg n "$channel_name" --arg g "$GUILD" --arg r "$role" --arg b "$bot_id" \
        --arg ma "$MEMBER_ALLOW" --arg ba "$BOT_ALLOW" '{name: $n, type: 0, permission_overwrites: [
          {id: $g, type: 0, deny: "1024"}, {id: $r, type: 0, allow: $ma}, {id: $b, type: 1, allow: $ba}]}')"
      [ "$CODE" = 201 ] || [ "$CODE" = 200 ] || fail "Discord refused to create the channel (the bot needs Manage Channels and Manage Roles: reinvite it with the link from 'app')"
      channel="$(jq -r .id <<<"$BODY")"; channel_name="$(jq -r .name <<<"$BODY")"
    fi

    set_kv "$ENV_FILE" DISCORD_HOME_CHANNEL "$channel"
    set_kv "$ENV_FILE" DISCORD_HOME_CHANNEL_NAME "$channel_name"
    add_to_list DISCORD_FREE_RESPONSE_CHANNELS "$channel"
    add_to_list DISCORD_ALLOWED_ROLES "$role"
    add_to_list DISCORD_ALLOWED_USERS "$owner"
    set_kv "$STATE" guild "$GUILD"; set_kv "$STATE" role "$role"; set_kv "$STATE" channel "$channel"
    echo "server=$GUILD_NAME ($GUILD)"
    echo "channel=#$channel_name ($channel) private, answers without a mention"
    echo "role=$role_name ($role) $owner_role to the owner"
    echo "next: hermes-setup gateway (restart the chat service to load this)"
    ;;

  say)
    shift; [ $# -gt 0 ] || { echo "usage: $(basename "$0") say <text>" >&2; exit 2; }
    channel="$(get_kv "$ENV_FILE" DISCORD_HOME_CHANNEL)"
    [ -n "$channel" ] || { echo "no channel yet: run '$(basename "$0") server' first" >&2; exit 3; }
    auth; api POST "/channels/$channel/messages" "$(jq -cn --arg t "$*" '{content: $t}')"
    [ "$CODE" = 200 ] || fail "Discord refused the message"
    echo "said in $channel"
    ;;

  access)
    action="${2:-list}"
    role="$(get_kv "$STATE" role)"
    [ -n "$role" ] || { echo "no access role yet: run '$(basename "$0") server' first" >&2; exit 3; }
    auth; pick_guild "$(get_kv "$STATE" guild)"
    case "$action" in
      list)
        api GET "/guilds/$GUILD/members?limit=1000"
        [ "$CODE" = 200 ] || fail "Discord refused to list the members (Server Members Intent must be on)"
        jq -r --arg r "$role" '.[] | select(.roles | index($r)) | "\(.user.username) (\(.user.id))"' <<<"$BODY"
        echo "users allowed by id: $(get_kv "$ENV_FILE" DISCORD_ALLOWED_USERS)"
        ;;
      add|remove)
        [ -n "${3:-}" ] || { echo "usage: $(basename "$0") access $action <username|id>" >&2; exit 2; }
        find_member "$3"
        if [ "$action" = add ]; then api PUT "/guilds/$GUILD/members/$MEMBER_ID/roles/$role"; else api DELETE "/guilds/$GUILD/members/$MEMBER_ID/roles/$role"; fi
        [ "$CODE" = 204 ] || fail "Discord refused to change the role"
        [ "$action" = add ] && echo "access given to $MEMBER_NAME ($MEMBER_ID)" || echo "access taken from $MEMBER_NAME ($MEMBER_ID)"
        ;;
      *) echo "usage: $(basename "$0") access list|add|remove [username|id]" >&2; exit 2 ;;
    esac
    ;;

  check)
    if [ -z "$(get_kv "$ENV_FILE" DISCORD_BOT_TOKEN)" ]; then echo "access=missing"; echo "gateway=$(gateway_state)"; exit 0; fi
    auth; api GET /users/@me
    if [ "$CODE" != 200 ]; then echo "access=refused (HTTP $CODE)"; echo "gateway=$(gateway_state)"; exit 0; fi
    echo "access=ok"
    echo "bot=$(jq -r .username <<<"$BODY") ($(jq -r .id <<<"$BODY"))"
    load_app
    intents_on && echo "intents=on" || echo "intents=off https://discord.com/developers/applications/$APP_ID/bot"
    case ",$(get_kv "$ENV_FILE" DISCORD_ALLOWED_USERS)," in *",$OWNER_ID,"*) echo "owner=$OWNER_NAME allowed" ;; *) echo "owner=$OWNER_NAME not allowed" ;; esac
    api GET /users/@me/guilds
    echo "servers=$(jq -r '[.[].name] | join(", ")' <<<"$BODY")"
    echo "saved_server=$(get_kv "$STATE" guild) channel=$(get_kv "$ENV_FILE" DISCORD_HOME_CHANNEL) role=$(get_kv "$STATE" role)"
    echo "gateway=$(gateway_state)"
    ;;

  *)
    sed -n '2,15p' "$0" >&2
    exit 2
    ;;
esac
