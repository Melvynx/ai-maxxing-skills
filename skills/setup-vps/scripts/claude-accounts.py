#!/usr/bin/env python3
"""Keep the Claude account with the best weekly delta first in the Hermes pool.

delta = % of the weekly window already elapsed - % of the weekly quota used.
The higher the delta, the more quota the account has left for the time left.
The account with the best delta gets priority 0 (`hermes auth priority`).

Hermes always sorts manual entries (`hermes auth add`) before the entry
borrowed from Claude Code (`claude_code`), so only manual entries can be
reordered: an account that must be able to lead has to be a manual entry.
With one account there is nothing to reorder: the run only writes its usage.

Each run writes what it saw to STATUS (no token in it): the Models page of
the dashboard shows it.

Usage: hermes-accounts [--dry-run]
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

HOME = os.path.expanduser("~")
HERMES_HOME = os.environ.get("HERMES_HOME") or os.path.join(HOME, ".hermes")
# cron runs with a short PATH: Hermes installs itself in ~/.local/bin
HERMES = shutil.which("hermes") or os.path.join(HOME, ".local/bin/hermes")
AUTH = os.path.join(HERMES_HOME, "auth.json")
CLAUDE_CODE_CREDS = os.path.join(HOME, ".claude/.credentials.json")
STATUS = os.path.join(HERMES_HOME, "cache/claude-pool-priority.json")
WEEK = 7 * 24 * 3600
FULL = 99.0  # a window used at this % or more is unusable
SWITCH_MARGIN = 5.0  # delta points needed to take the lead (each switch drops the prompt cache)
DRY = "--dry-run" in sys.argv


def log(msg):
    print(datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ"), msg, flush=True)


def entries():
    try:
        pool = json.load(open(AUTH))["credential_pool"].get("anthropic", [])
    except (OSError, KeyError, ValueError):
        return []
    out = [e for e in pool if e.get("auth_type") == "oauth"]
    return sorted(out, key=lambda e: e.get("priority", 0))


def token(entry):
    if entry.get("access_token"):
        return entry["access_token"]
    if entry.get("source") == "claude_code":
        return json.load(open(CLAUDE_CODE_CREDS))["claudeAiOauth"]["accessToken"]
    return None


def api(path, tok):
    req = urllib.request.Request(
        "https://api.anthropic.com" + path,
        headers={
            "Authorization": "Bearer " + tok,
            "anthropic-beta": "oauth-2025-04-20",
            "User-Agent": "claude-cli/2.0.0",
        },
    )
    return json.load(urllib.request.urlopen(req, timeout=20))


def hermes(*args):
    return subprocess.run([HERMES, "auth", *args], capture_output=True, text=True, timeout=90)


def fetch(entry):
    """Usage of one entry, with one token refresh when the token is rejected."""
    try:
        return api("/api/oauth/usage", token(entry))
    except urllib.error.HTTPError as err:
        if err.code != 401:
            raise
    hermes("refresh", "anthropic", entry["id"])
    entry.update(next(e for e in entries() if e["id"] == entry["id"]))
    return api("/api/oauth/usage", token(entry))


def score(data, now):
    week = data.get("seven_day") or {}
    five_hour = data.get("five_hour") or {}
    used = float(week.get("utilization") or 0)
    elapsed = 0.0
    if week.get("resets_at"):
        left = datetime.fromisoformat(week["resets_at"]).timestamp() - now
        elapsed = max(0.0, min(100.0, 100 - left / WEEK * 100))
    five = float(five_hour.get("utilization") or 0)
    return {
        "used": used,
        "elapsed": elapsed,
        "delta": elapsed - used,
        "five": five,
        "full": used >= FULL or five >= FULL,
        "resets_at": week.get("resets_at"),
    }


def known_emails():
    try:
        return {a["id"]: a.get("email") for a in json.load(open(STATUS))["accounts"]}
    except Exception:
        return {}


def email(entry, known):
    """The account behind an entry; the last known one when the profile does not answer."""
    try:
        return api("/api/oauth/profile", token(entry))["account"]["email"]
    except Exception:
        return known.get(entry["id"])


def save(order, stats, note, now):
    """What the dashboard shows: the accounts in pool order, first = the one Hermes uses."""
    if DRY:
        return
    known = known_emails()
    accounts = [
        {
            "id": e["id"],
            "label": e["label"],
            "email": email(e, known),
            "manual": str(e.get("source", "")).startswith("manual"),
            **{k: (round(v, 1) if isinstance(v, float) else v) for k, v in stats.get(e["id"], {}).items()},
        }
        for e in order
    ]
    status = {
        "checked_at": datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": note,
        "switch_margin": SWITCH_MARGIN,
        "accounts": accounts,
    }
    os.makedirs(os.path.dirname(STATUS), exist_ok=True)
    tmp = STATUS + ".tmp"
    with open(tmp, "w") as out:
        json.dump(status, out, indent=2)
    os.replace(tmp, STATUS)


def main():
    pool = entries()
    if not pool:
        log("no Claude account in the Hermes pool yet")
        return
    now = time.time()
    stats = {}
    for entry in pool:
        try:
            stats[entry["id"]] = score(fetch(entry), now)
        except Exception as err:  # unknown usage: never reorder blind
            log(f"SKIP {entry['label']}: usage unavailable ({str(err)[:120]}), order unchanged")
            return

    def rank(entry):
        s = stats[entry["id"]]
        return (s["full"], -s["delta"])

    summary = " | ".join(
        "{label}: used {used:.0f}% elapsed {elapsed:.0f}% delta {delta:+.0f}{flag}".format(
            label=e["label"], flag=" FULL" if stats[e["id"]]["full"] else "", **stats[e["id"]]
        )
        for e in pool
    )
    # Rounded: two entries of the same account differ by a hair, the first in the pool wins the tie.
    best = min(pool, key=lambda e: (stats[e["id"]]["full"], -round(stats[e["id"]]["delta"])))
    manual = [e for e in pool if str(e.get("source", "")).startswith("manual")]
    seeded = [e for e in pool if e not in manual]
    wanted = sorted(manual, key=rank)

    # The current leader keeps the lead unless it is full or clearly behind.
    if manual and wanted[0]["id"] != manual[0]["id"]:
        lead, challenger = stats[manual[0]["id"]], stats[wanted[0]["id"]]
        if not lead["full"] and challenger["delta"] - lead["delta"] < SWITCH_MARGIN:
            wanted = manual

    if [e["id"] for e in wanted] == [e["id"] for e in manual]:
        note = "one account" if len(pool) == 1 else "order ok"
        if best["id"] != pool[0]["id"] and best in manual:
            note = f"order kept, {best['label']} leads by less than {SWITCH_MARGIN:.0f} points"
        elif best["id"] != pool[0]["id"]:
            note = f"best is {best['label']} but Hermes keeps it behind the manual entries (add it with `hermes auth add anthropic --type oauth`)"
        log(f"{summary} -> {note}")
        save(pool, stats, note, now)
        return

    order = " > ".join(e["label"] for e in wanted)
    if DRY:
        log(f"{summary} -> would set {order}")
        return
    for position, entry in enumerate(wanted):
        res = hermes("priority", "anthropic", entry["id"], str(position))
        if res.returncode != 0:
            log(f"ERROR priority {entry['label']}: {(res.stderr or res.stdout)[-200:]}")
            sys.exit(1)
    log(f"{summary} -> set {order}")
    save(wanted + seeded, stats, f"set {order}", now)


if __name__ == "__main__":
    main()
