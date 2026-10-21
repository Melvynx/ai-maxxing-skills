#!/usr/bin/env bash
# Connect one Google account to gog, with Google's sign-in pages shown in Chrome AI (the AI's own Chrome window).
#   gog-oauth.sh <email> [services]    default services: gmail,calendar,drive,docs,sheets,slides,contacts,tasks
# Needs gog, jq, dev-browser, Chrome AI open, and an OAuth client stored with `gog auth credentials set`.
# Waits up to 10 minutes for the user to choose the account and allow access in the Chrome AI window.
# The sign-in code never reaches the terminal: the browser saves it in a file that gog reads, then the file is deleted.
# Exit codes: 0 ok, 2 bad usage, 3 missing tool, Chrome AI closed or no OAuth client, 4 access not allowed in time, 5 gog refused the code.
set -euo pipefail

email="${1:-}"
services="${2:-gmail,calendar,drive,docs,sheets,slides,contacts,tasks}"
[[ "$email" == *@* ]] || { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
for tool in gog jq dev-browser curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is missing" >&2; exit 3; }
done

port="${CHROME_AI_PORT:-9333}"
command -v chrome-ai >/dev/null 2>&1 && chrome-ai start >/dev/null
curl -fsS -m 3 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1 || { echo "Chrome AI is not open on port $port: run 'chrome-ai start'" >&2; exit 3; }
gog auth credentials list --json --no-input | jq -e '.clients | length > 0' >/dev/null || { echo "no OAuth client in gog yet: store one with 'gog auth credentials set <file>'" >&2; exit 3; }

auth_url="$(gog auth add "$email" --services "$services" --force-consent --remote --step 1 --json --no-input | jq -r '.auth_url // empty')"
[ -n "$auth_url" ] || { echo "gog did not give a sign-in address" >&2; exit 3; }

name="gog-callback-$$.txt"
file="$HOME/.dev-browser/tmp/$name"
trap 'rm -f "$file"' EXIT

# Google sends the browser back to gog's local address with the code. Nothing listens there:
# the script catches that request, saves its address for gog, and shows a done page instead of an error.
out="$(dev-browser --connect "http://127.0.0.1:$port" --timeout 660 <<JS
const authUrl = $(jq -Rn --arg u "$auth_url" '$u');
const redirect = decodeURIComponent(authUrl.match(/[?&]redirect_uri=([^&]+)/)[1]);
const page = await browser.getPage("connect-google");
await page.bringToFront();
const callback = page.waitForRequest((r) => r.url().startsWith(redirect), { timeout: 600000 });
await page.goto(authUrl);
const url = (await callback).url();
await writeFile("$name", url);
const allowed = !/[?&]error=/.test(url);
await page.setContent(allowed
  ? '<body style="font:18px system-ui;padding:48px"><h1>Google is connected</h1><p>You can close this tab.</p></body>'
  : '<body style="font:18px system-ui;padding:48px"><h1>Access was not allowed</h1><p>Nothing was saved.</p></body>');
console.log(JSON.stringify({ allowed }));
JS
)" || { echo "no answer from Google within 10 minutes" >&2; exit 4; }
grep -q '"allowed":true' <<<"$out" || { echo "access was not allowed in the Google page" >&2; exit 4; }

gog auth add "$email" --services "$services" --remote --step 2 --auth-url "$(cat "$file")" --no-input >/dev/null || exit 5
gog auth list --check --json --no-input | jq -r --arg e "$email" '.accounts[] | select(.email == $e) | "connected=\(.email) services=\(.services | join(","))"'
