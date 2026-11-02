#!/usr/bin/env python3
"""youtube CLI: one file, Python 3 standard library only. Made with connect-youtube-developer-platform.

Talks to the YouTube Data API v3 and the YouTube Analytics API with the user's own
Google Cloud project, so every call uses that project's own daily quota.
"""

import base64, datetime, getpass, hashlib, json, mimetypes, os, secrets, sys, time
import urllib.error, urllib.parse, urllib.request
from pathlib import Path

TOOL = "youtube"
DATA = "https://www.googleapis.com/youtube/v3"
UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos"
ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPES = [
    "https://www.googleapis.com/auth/youtube.force-ssl",  # read and manage videos, playlists, comments
    "https://www.googleapis.com/auth/yt-analytics.readonly",  # channel analytics
]
REDIRECT = "http://127.0.0.1:8765"  # Desktop clients accept any loopback port; nothing listens, the browser catches it
CONFIG = Path.home() / ".config" / f"{TOOL}-cli" / "config.json"
CONFIRM = {"reply", "update", "upload", "delete-comment"}  # writes to the channel: need --yes


def fail(msg):
    sys.exit(f"Error: {msg}")


def load():
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else {}


def save(cfg):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(cfg, f, indent=2)
    CONFIG.chmod(0o600)


def http(method, url, data=None, headers=None, raw=False):
    req = urllib.request.Request(url, data=data, method=method, headers={"User-Agent": f"{TOOL}-cli", **(headers or {})})
    try:
        with urllib.request.urlopen(req) as res:
            body = res.read()
            return (res, body) if raw else (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            err = json.loads(body).get("error", {})
            msg = err.get("message") if isinstance(err, dict) else err
            reason = ((err.get("errors") or [{}])[0].get("reason") if isinstance(err, dict) else "") or ""
        except ValueError:
            msg, reason = body[:300], ""
        if reason in ("quotaExceeded", "dailyLimitExceeded"):
            fail("daily quota used up for this Google Cloud project. It resets at midnight Pacific time. See: quota")
        fail(f"HTTP {e.code} on {method} {url.split('?')[0]}: {msg}")


def form(url, fields):
    return http("POST", url, urllib.parse.urlencode(fields).encode(), {"Content-Type": "application/x-www-form-urlencoded"})


def token():
    cfg = load()
    if not cfg.get("refresh_token"):
        fail("not connected. Run /connect-youtube-developer-platform (or: auth-url, then login)")
    if cfg.get("access_token") and cfg.get("expires_at", 0) > time.time() + 60:
        return cfg["access_token"]
    res = form(TOKEN_URL, {"client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
                           "refresh_token": cfg["refresh_token"], "grant_type": "refresh_token"})
    cfg["access_token"], cfg["expires_at"] = res["access_token"], time.time() + int(res.get("expires_in", 3600))
    save(cfg)
    return cfg["access_token"]


def api(method, url, params=None, body=None):
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    headers = {"Authorization": f"Bearer {token()}", "Accept": "application/json"}
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    return http(method, url, data, headers)


def out(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False))


# ---- connection -------------------------------------------------------------

def cmd_auth_url(args, opts):
    """Print Google's sign-in address. Needs the client saved first: auth-url --client-file <google-client.json>"""
    cfg = load()
    if opts.get("client-file"):
        path = Path(opts["client-file"]).expanduser()
        client = json.loads(path.read_text())
        client = client.get("installed") or client.get("web") or client
        cfg.update(client_id=client["client_id"], client_secret=client["client_secret"])
        if opts.get("project"):
            cfg["project_id"] = opts["project"]
        path.unlink()  # the key file is not needed anymore, it now lives only in the config (chmod 600)
    if not cfg.get("client_id"):
        fail("no Google key saved yet: auth-url --client-file <file> [--project <id>]")
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    cfg["pending"] = {"verifier": verifier, "state": secrets.token_urlsafe(16)}
    save(cfg)
    print(AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": cfg["client_id"], "redirect_uri": REDIRECT, "response_type": "code",
        "scope": " ".join(SCOPES), "access_type": "offline", "prompt": "consent",
        "include_granted_scopes": "true", "state": cfg["pending"]["state"],
        "code_challenge": challenge, "code_challenge_method": "S256"}))


def cmd_login(args, opts):
    """Finish the sign-in with the address Google sent back: login --callback-file <file> (or the address on stdin)"""
    cfg = load()
    pending = cfg.get("pending") or fail("run auth-url first")
    if opts.get("callback-file"):
        path = Path(opts["callback-file"]).expanduser()
        url = path.read_text().strip()
        path.unlink()
    else:
        url = (getpass.getpass("Address Google sent back (hidden): ") if sys.stdin.isatty() else sys.stdin.read()).strip()
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
    if query.get("error"):
        fail(f"access not allowed ({query['error']})")
    if query.get("state") != pending["state"] or not query.get("code"):
        fail("this address does not match the last auth-url, run auth-url again")
    res = form(TOKEN_URL, {"client_id": cfg["client_id"], "client_secret": cfg["client_secret"], "code": query["code"],
                           "code_verifier": pending["verifier"], "redirect_uri": REDIRECT, "grant_type": "authorization_code"})
    if not res.get("refresh_token"):
        fail("Google gave no lasting access. Remove the app at https://myaccount.google.com/permissions and run auth-url again")
    cfg.pop("pending")
    cfg.update(refresh_token=res["refresh_token"], access_token=res["access_token"],
               expires_at=time.time() + int(res.get("expires_in", 3600)))
    save(cfg)
    ch = channel_raw()
    print(f"connected={ch['snippet']['title']} channel={ch['id']}")


def cmd_logout(args, opts):
    """Forget the access on this computer"""
    CONFIG.unlink(missing_ok=True)
    print("Access removed from this computer. To revoke it at Google: https://myaccount.google.com/permissions")


# ---- reads ------------------------------------------------------------------

def channel_raw():
    items = api("GET", f"{DATA}/channels", {"part": "snippet,statistics,contentDetails", "mine": "true"}).get("items") or []
    return items[0] if items else fail("this Google account has no YouTube channel")


def cmd_channel(args, opts):
    """Your channel: name, subscribers, views, video count"""
    ch = channel_raw()
    out({"id": ch["id"], "title": ch["snippet"]["title"], "handle": ch["snippet"].get("customUrl"), **ch["statistics"]})


def video_rows(ids):
    if not ids:
        return []
    items = api("GET", f"{DATA}/videos", {"part": "snippet,statistics,contentDetails,status", "id": ",".join(ids)}).get("items", [])
    return [{"id": v["id"], "title": v["snippet"]["title"], "published": v["snippet"]["publishedAt"][:10],
             "privacy": v["status"]["privacyStatus"], "duration": v["contentDetails"]["duration"],
             "views": int(v["statistics"].get("viewCount", 0)), "likes": int(v["statistics"].get("likeCount", 0)),
             "comments": int(v["statistics"].get("commentCount", 0))} for v in items]


def cmd_videos(args, opts):
    """Your latest videos with views, likes, comments: videos [--max 10]"""
    uploads = channel_raw()["contentDetails"]["relatedPlaylists"]["uploads"]
    items = api("GET", f"{DATA}/playlistItems", {"part": "contentDetails", "playlistId": uploads,
                                                 "maxResults": min(int(opts.get("max", 10)), 50)}).get("items", [])
    out(video_rows([i["contentDetails"]["videoId"] for i in items]))


def cmd_video(args, opts):
    """One video, full details: video <videoId>"""
    args or fail("video <videoId>")
    items = api("GET", f"{DATA}/videos", {"part": "snippet,statistics,contentDetails,status", "id": args[0]}).get("items")
    out(items[0] if items else fail("video not found"))


def cmd_search(args, opts):
    """Search YouTube (costs 100 quota units): search <words> [--max 10]"""
    args or fail("search <words>")
    items = api("GET", f"{DATA}/search", {"part": "snippet", "q": " ".join(args), "type": "video",
                                          "maxResults": min(int(opts.get("max", 10)), 50)}).get("items", [])
    out([{"id": i["id"]["videoId"], "title": i["snippet"]["title"], "channel": i["snippet"]["channelTitle"],
          "published": i["snippet"]["publishedAt"][:10]} for i in items])


def cmd_comments(args, opts):
    """Latest comments on a video, or on the whole channel: comments [videoId] [--max 20]"""
    params = {"part": "snippet", "maxResults": min(int(opts.get("max", 20)), 100), "order": "time", "textFormat": "plainText"}
    if args:
        params["videoId"] = args[0]
    else:
        params["allThreadsRelatedToChannelId"] = channel_raw()["id"]
    items = api("GET", f"{DATA}/commentThreads", params).get("items", [])
    out([{"id": t["snippet"]["topLevelComment"]["id"], "video": t["snippet"].get("videoId"),
          "author": t["snippet"]["topLevelComment"]["snippet"]["authorDisplayName"],
          "text": t["snippet"]["topLevelComment"]["snippet"]["textDisplay"],
          "likes": t["snippet"]["topLevelComment"]["snippet"]["likeCount"], "replies": t["snippet"]["totalReplyCount"],
          "date": t["snippet"]["topLevelComment"]["snippet"]["publishedAt"][:16]} for t in items])


def report(params):
    res = api("GET", ANALYTICS, {"ids": "channel==MINE", **params})
    cols = [c["name"] for c in res.get("columnHeaders", [])]
    return [dict(zip(cols, row)) for row in res.get("rows", [])]


def period(opts):
    end = datetime.date.today()
    return (end - datetime.timedelta(days=int(opts.get("days", 28)))).isoformat(), end.isoformat()


def cmd_analytics(args, opts):
    """Day by day: views, watch time, subscribers: analytics [--days 28]"""
    start, end = period(opts)
    out(report({"startDate": start, "endDate": end, "dimensions": "day", "sort": "day",
                "metrics": "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments"}))


def cmd_top(args, opts):
    """Your best videos over a period: top [--days 28] [--max 10]"""
    start, end = period(opts)
    rows = report({"startDate": start, "endDate": end, "dimensions": "video", "sort": "-views",
                   "maxResults": int(opts.get("max", 10)),
                   "metrics": "views,estimatedMinutesWatched,averageViewPercentage,subscribersGained,likes"})
    titles = {v["id"]: v["title"] for v in video_rows([r["video"] for r in rows])}
    out([{"title": titles.get(r["video"]), **r} for r in rows])


def cmd_quota(args, opts):
    """Where to see the daily quota left (the API has no call for it)"""
    project = load().get("project_id")
    url = "https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas" + (f"?project={project}" if project else "")
    out({"daily_quota": "10000 units per day by default, reset at midnight Pacific time",
         "costs": {"read (channel, videos, comments, playlists)": 1, "search": 100, "reply / update": 50,
                   "upload": "the biggest cost, see the quota page"},
         "see_usage": url,
         "more_quota": "https://support.google.com/youtube/contact/yt_api_form"})


# ---- writes (need --yes) ----------------------------------------------------

def cmd_reply(args, opts):
    """Reply to a comment: reply <commentId> <text> --yes"""
    len(args) >= 2 or fail("reply <commentId> <text>")
    out(api("POST", f"{DATA}/comments", {"part": "snippet"},
            {"snippet": {"parentId": args[0], "textOriginal": " ".join(args[1:])}}))


def cmd_delete_comment(args, opts):
    """Delete one of your comments: delete-comment <commentId> --yes"""
    args or fail("delete-comment <commentId>")
    api("DELETE", f"{DATA}/comments", {"id": args[0]})
    print("deleted")


def cmd_update(args, opts):
    """Change a video's title, description, tags or privacy: update <videoId> [--title ..] [--description ..] [--tags a,b] [--privacy public|unlisted|private] --yes"""
    args or fail("update <videoId> --title ...")
    v = (api("GET", f"{DATA}/videos", {"part": "snippet,status", "id": args[0]}).get("items") or [None])[0] or fail("video not found")
    snippet = {k: v["snippet"][k] for k in ("title", "description", "categoryId", "tags", "defaultLanguage") if k in v["snippet"]}
    snippet.update({k: opts[k] for k in ("title", "description") if k in opts})
    if "tags" in opts:
        snippet["tags"] = [t.strip() for t in opts["tags"].split(",") if t.strip()]
    body, parts = {"id": args[0], "snippet": snippet}, ["snippet"]
    if "privacy" in opts:
        body["status"], parts = {"privacyStatus": opts["privacy"]}, parts + ["status"]
    res = api("PUT", f"{DATA}/videos", {"part": ",".join(parts)}, body)
    out({"id": res["id"], "title": res["snippet"]["title"], "privacy": res.get("status", {}).get("privacyStatus")})


def cmd_upload(args, opts):
    """Upload a video, private by default: upload <file> --title .. [--description ..] [--tags a,b] [--privacy private] --yes"""
    (args and "title" in opts) or fail("upload <file> --title ...")
    path = Path(args[0]).expanduser()
    path.is_file() or fail(f"no file at {path}")
    meta = {"snippet": {"title": opts["title"], "description": opts.get("description", ""),
                        "tags": [t.strip() for t in opts.get("tags", "").split(",") if t.strip()]},
            "status": {"privacyStatus": opts.get("privacy", "private"), "selfDeclaredMadeForKids": False}}
    size, kind = path.stat().st_size, mimetypes.guess_type(path.name)[0] or "video/*"
    res, _ = http("POST", UPLOAD + "?uploadType=resumable&part=snippet,status", json.dumps(meta).encode(),
                  {"Authorization": f"Bearer {token()}", "Content-Type": "application/json; charset=UTF-8",
                   "X-Upload-Content-Length": str(size), "X-Upload-Content-Type": kind}, raw=True)
    with path.open("rb") as f:
        result = http("PUT", res.headers["Location"], f, {"Content-Length": str(size), "Content-Type": kind})
    out({"id": result["id"], "url": f"https://youtu.be/{result['id']}", "privacy": result["status"]["privacyStatus"]})


def cmd_api(args, opts):
    """Any Data API call: api <METHOD> <path> [--query k=v]... [--data JSON] (e.g. api GET /playlists --query part=snippet --query mine=true)"""
    len(args) >= 2 or fail("api <METHOD> <path>")
    method = args[0].upper()
    if method != "GET" and "yes" not in opts:
        fail("this changes the channel, add --yes")
    out(api(method, DATA + "/" + args[1].lstrip("/"), dict(opts["query"]) or None,
            json.loads(opts["data"]) if opts.get("data") else None))


COMMANDS = {name[4:].replace("_", "-"): fn for name, fn in list(globals().items()) if name.startswith("cmd_")}


def usage():
    print(f"Usage: {Path(sys.argv[0]).name} <command> [args] [--option value] [--yes]\n")
    for name, fn in COMMANDS.items():
        print(f"  {name:<15} {(fn.__doc__ or '').strip()}")


def main():
    args, opts, argv = [], {"query": []}, sys.argv[1:]
    while argv:
        a = argv.pop(0)
        if a == "--yes":
            opts["yes"] = True
        elif a.startswith("--"):
            name, eq, value = a[2:].partition("=")
            value = value if eq else (argv.pop(0) if argv else fail(f"--{name} needs a value"))
            if name == "query":
                opts["query"].append(tuple(value.split("=", 1) + [""])[:2])
            else:
                opts[name] = value
        else:
            args.append(a)
    cmd, rest = (args[0], args[1:]) if args else ("help", [])
    if cmd not in COMMANDS:
        return usage()
    if cmd in CONFIRM and "yes" not in opts:
        fail("this changes your channel: show the user what will happen, get their OK, then add --yes")
    COMMANDS[cmd](rest, opts)


if __name__ == "__main__":
    main()
