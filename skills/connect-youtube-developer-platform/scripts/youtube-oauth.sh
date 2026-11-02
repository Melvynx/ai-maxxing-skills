#!/usr/bin/env bash
# Connect the user's YouTube channel to youtube.py, with Google's sign-in pages shown in Chrome AI (the AI's own Chrome window).
#   youtube-oauth.sh [path to youtube.py]    default: ~/.agents/skills/youtube-cli/scripts/youtube.py
# Needs python3, dev-browser, Chrome AI open, and the Google key saved with `youtube.py auth-url --client-file <file>` once.
# Waits up to 10 minutes for the user to choose the account (and channel) and allow access in the Chrome AI window.
# The sign-in code never reaches the terminal: the browser saves it in a file that youtube.py reads, then the file is deleted.
# Exit codes: 0 ok, 3 missing tool, Chrome AI closed or no Google key, 4 access not allowed in time, 5 Google refused the code.
set -euo pipefail

cli="${1:-$HOME/.agents/skills/youtube-cli/scripts/youtube.py}"
for tool in python3 dev-browser curl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is missing" >&2; exit 3; }
done
[ -f "$cli" ] || { echo "no youtube.py at $cli" >&2; exit 3; }

port="${CHROME_AI_PORT:-9333}"
command -v chrome-ai >/dev/null 2>&1 && chrome-ai start >/dev/null
curl -fsS -m 3 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1 || { echo "Chrome AI is not open on port $port: run 'chrome-ai start'" >&2; exit 3; }

auth_url="$(python3 "$cli" auth-url)" || exit 3

name="youtube-callback-$$.txt"
file="$HOME/.dev-browser/tmp/$name"
trap 'rm -f "$file"' EXIT

# Google sends the browser back to a local address with the code. Nothing listens there:
# the script catches that request, saves its address for youtube.py, and shows a done page instead of an error.
out="$(dev-browser --connect "http://127.0.0.1:$port" --timeout 660 <<JS
const authUrl = $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$auth_url");
const redirect = decodeURIComponent(authUrl.match(/[?&]redirect_uri=([^&]+)/)[1]);
const page = await browser.getPage("connect-youtube");
await page.bringToFront();
const callback = page.waitForRequest((r) => r.url().startsWith(redirect), { timeout: 600000 });
await page.goto(authUrl);
const url = (await callback).url();
await writeFile("$name", url);
const allowed = !/[?&]error=/.test(url);
await page.setContent(allowed
  ? '<body style="font:18px system-ui;padding:48px"><h1>YouTube is connected</h1><p>You can close this tab.</p></body>'
  : '<body style="font:18px system-ui;padding:48px"><h1>Access was not allowed</h1><p>Nothing was saved.</p></body>');
console.log(JSON.stringify({ allowed }));
JS
)" || { echo "no answer from Google within 10 minutes" >&2; exit 4; }
grep -q '"allowed":true' <<<"$out" || { echo "access was not allowed in the Google page" >&2; exit 4; }

python3 "$cli" login --callback-file "$file" || exit 5
