#!/usr/bin/env python3
"""instagram CLI: one file, Python 3 standard library only. Made with connect-instagram-developer-platform.

Two ways to reach the same Instagram account, chosen at login:
  - "meta":   the user's own Meta app, Unified Login (graph.facebook.com). Free. The access has no expiry date.
  - "zernio": a Zernio account (https://zernio.com, REST API) that holds the Instagram connection. Simple, paid past 2 accounts.
Commands: profile, posts, comments, DMs, publishing.
"""

import getpass, json, os, sys, time, uuid, urllib.error, urllib.parse, urllib.request
from pathlib import Path

TOOL = "instagram"
HOST = "https://graph.facebook.com"
ZERNIO = "https://zernio.com/api/v1"
VERSION = "v27.0"
CONFIG = Path.home() / ".config" / f"{TOOL}-cli" / "config.json"
CONFIRM = {"send", "reply-comment", "hide-comment", "publish"}  # acts in the user's name: need --yes


def fail(msg):
    sys.exit(f"Error: {msg}")


def load():
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else {}


def save(cfg):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(cfg, f, indent=2)
    CONFIG.chmod(0o600)


def http(method, path, params=None, body=None, token=None):
    cfg = load()
    url = f"{HOST}/{cfg.get('api_version', VERSION)}/{path.lstrip('/')}"
    params = {k: v for k, v in (params or {}).items() if v is not None}
    headers = {"User-Agent": f"{TOOL}-cli", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=headers)) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            err = json.loads(raw).get("error", {})
            msg, code = err.get("message", raw[:300]), err.get("code")
        except ValueError:
            msg, code = raw[:300], None
        if code == 190:
            fail("the Instagram access was removed or refused by Meta. Run /connect-instagram-developer-platform again")
        if code == 10 or "outside of allowed window" in msg:
            fail(f"{msg} (Instagram only lets you answer a DM within 24 hours of the person's last message)")
        fail(f"HTTP {e.code} on {method} /{path.lstrip('/')}: {msg}")


def zhttp(method, path, params=None, body=None):
    cfg = load()
    key = cfg.get("zernio_key") or fail("not connected. Run /connect-instagram-developer-platform (or: login --zernio)")
    params = {k: v for k, v in (params or {}).items() if v is not None}
    url = f"{ZERNIO}/{path.lstrip('/')}" + ("?" + urllib.parse.urlencode(params) if params else "")
    headers = {"Authorization": f"Bearer {key}", "User-Agent": f"{TOOL}-cli", "Accept": "application/json"}
    data = None
    if body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
        if method == "POST":
            headers["Idempotency-Key"] = str(uuid.uuid4())
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=headers)) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        fail(f"Zernio HTTP {e.code} on {method} /{path.lstrip('/')}: {e.read().decode()[:300]}")


def zernio():
    return load().get("provider") == "zernio"


def zaccount():
    return load().get("account_id") or fail("not connected. Run /connect-instagram-developer-platform (or: login --zernio)")


def token():
    cfg = load()
    if not cfg.get("access_token"):
        fail("not connected. Run /connect-instagram-developer-platform (or: login)")
    return cfg["access_token"]


def ig():
    """The Instagram account id every call is made on."""
    return load().get("user_id") or fail("not connected. Run /connect-instagram-developer-platform (or: login)")


def api(method, path, params=None, body=None):
    return http(method, path, params, body, token())


def out(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False))


def page(path, params, limit):
    """Follow Meta's paging until `limit` items."""
    items, after = [], None
    while len(items) < limit:
        res = api("GET", path, {**params, "limit": min(limit - len(items), 50), "after": after})
        items += res.get("data", [])
        after = (res.get("paging") or {}).get("cursors", {}).get("after")
        if not after or not (res.get("paging") or {}).get("next"):
            break
    return items[:limit]


# ---- connection -------------------------------------------------------------

def cmd_login(args, opts):
    """Save the access: login --from <keys.json> (app_id, app_secret, access_token; deleted once connected), or type them"""
    cfg = load()
    if opts.get("zernio"):
        return login_zernio(cfg, opts)
    if opts.get("from"):
        path = Path(opts["from"]).expanduser()
        keys = json.loads(path.read_text())
    elif sys.stdin.isatty():
        keys = {"app_id": input("Meta app ID: ").strip(),
                "app_secret": getpass.getpass("Meta app secret (hidden): ").strip(),
                "access_token": getpass.getpass("Access token (hidden): ").strip()}
    else:
        keys = json.loads(sys.stdin.read())
    keys.get("access_token") or fail("no access token")
    access = keys["access_token"].strip()
    accounts = http("GET", "me/assigned_instagram_accounts", {"fields": "id,username"}, token=access).get("data", [])
    if not accounts:  # an access tied to a Facebook user: look through its pages instead
        pages = http("GET", "me/accounts", {"fields": "instagram_business_account{id,username}"}, token=access).get("data", [])
        accounts = [p["instagram_business_account"] for p in pages if p.get("instagram_business_account")]
    accounts or fail("this access sees no Instagram account. Check the account is Professional and was added as Instagram Tester and accepted")
    me = accounts[0]
    cfg.update(app_id=keys.get("app_id"), app_secret=keys.get("app_secret"), access_token=access,
               token_saved_at=time.time(), user_id=me["id"], username=me.get("username"))
    save(cfg)
    if opts.get("from"):
        path.unlink()  # saved in the config: the keys file is not needed any more
    print(f"connected=@{me.get('username')} user_id={me['id']}")


def login_zernio(cfg, opts):
    """login --zernio [--from <keys.json>]: keys.json holds {"zernio_key": "sk_..."}; reads the key from stdin or a hidden prompt otherwise"""
    if opts.get("from"):
        path = Path(opts["from"]).expanduser()
        key = json.loads(path.read_text()).get("zernio_key", "")
    elif sys.stdin.isatty():
        key = getpass.getpass("Zernio API key (hidden): ")
    else:
        key = sys.stdin.read()
    key = key.strip()
    key.startswith("sk_") or fail("the Zernio key starts with sk_ (zernio.com/dashboard/api-keys)")
    cfg.update(provider="zernio", zernio_key=key)
    save(cfg)
    accounts = zhttp("GET", "accounts")
    accounts = accounts.get("accounts", accounts.get("data", accounts)) if isinstance(accounts, dict) else accounts
    ig = [a for a in accounts if a.get("platform") == "instagram"]
    ig or fail("no Instagram account in Zernio yet. Connect it first: instagram.py zernio-connect")
    a = ig[0]
    cfg.update(account_id=a.get("_id") or a.get("id"), profile_id=(a.get("profileId") or {}).get("_id") if isinstance(a.get("profileId"), dict) else a.get("profileId"),
               username=a.get("username") or a.get("name"))
    save(cfg)
    if opts.get("from"):
        path.unlink()
    print(f"connected=@{cfg['username']} via Zernio account_id={cfg['account_id']}")


def cmd_zernio_connect(args, opts):
    """Zernio only: print the link where the owner connects their Instagram: zernio-connect [--login-method instagram_login|facebook_login]"""
    cfg = load()
    cfg.get("zernio_key") or fail("save the Zernio key first: login --zernio")
    profile = cfg.get("profile_id")
    if not profile:
        profiles = zhttp("GET", "profiles")
        profiles = profiles.get("profiles", profiles.get("data", profiles)) if isinstance(profiles, dict) else profiles
        profile = (profiles[0].get("_id") or profiles[0].get("id")) if profiles else fail("no Zernio profile: create one at zernio.com/dashboard")
    res = zhttp("GET", "connect/instagram", {"profileId": profile, "loginMethod": opts.get("login-method")})
    print(res.get("authUrl") or json.dumps(res))


def cmd_logout(args, opts):
    """Forget the access on this computer"""
    CONFIG.unlink(missing_ok=True)
    print("Access removed from this computer. To cut it at Meta too: Instagram > Settings > Website permissions > Apps and websites.")


# ---- reads ------------------------------------------------------------------

def cmd_me(args, opts):
    """Your account: username, followers, posts"""
    if zernio():
        return out(zhttp("GET", "accounts"))
    out(api("GET", ig(), {"fields": "id,username,name,followers_count,follows_count,media_count"}))


def cmd_posts(args, opts):
    """Your latest posts with likes and comments: posts [--max 10]"""
    if zernio():
        return out(zhttp("GET", "analytics", {"accountId": zaccount(), "platform": "instagram", "limit": int(opts.get("max", 10))}))
    out(page(f"{ig()}/media", {"fields": "id,caption,media_type,permalink,timestamp,like_count,comments_count"}, int(opts.get("max", 10))))


def cmd_post_stats(args, opts):
    """Stats of one post: post-stats <mediaId> [--metrics views,reach,likes,comments,shares,saved]"""
    args or fail("post-stats <mediaId>")
    if zernio():
        return out(zhttp("GET", "analytics", {"postId": args[0], "accountId": zaccount()}))
    res = api("GET", f"{args[0]}/insights", {"metric": opts.get("metrics", "views,reach,likes,comments,shares,saved")})
    out({m["name"]: (m.get("values") or [{}])[0].get("value", m.get("total_value", {}).get("value")) for m in res.get("data", [])})


def cmd_comments(args, opts):
    """Comments on a post: comments <mediaId> [--max 20]"""
    args or fail("comments <mediaId>")
    if zernio():
        return out(zhttp("GET", f"inbox/comments/{args[0]}", {"accountId": zaccount(), "limit": int(opts.get("max", 20))}))
    out(page(f"{args[0]}/comments", {"fields": "id,text,username,timestamp,like_count,replies{id,text,username}"}, int(opts.get("max", 20))))


def cmd_dms(args, opts):
    """Latest DM conversations with the last message: dms [--max 10]"""
    if zernio():
        return out(zhttp("GET", "inbox/conversations", {"accountId": zaccount(), "status": "active", "limit": int(opts.get("max", 10))}))
    convs = page(f"{ig()}/conversations", {"platform": "instagram", "fields": "id,updated_time,participants,messages.limit(1){message,from,created_time}"},
                 int(opts.get("max", 10)))
    me = str(load().get("user_id"))
    rows = []
    for c in convs:
        people = [p for p in (c.get("participants") or {}).get("data", []) if str(p.get("id")) != me]
        last = ((c.get("messages") or {}).get("data") or [{}])[0]
        rows.append({"conversation": c["id"], "with": people[0].get("username") if people else None,
                     "with_id": people[0].get("id") if people else None, "updated": c.get("updated_time"),
                     "last_from": (last.get("from") or {}).get("username"), "last_message": last.get("message")})
    out(rows)


def cmd_messages(args, opts):
    """Messages of one conversation, newest first: messages <conversationId> [--max 20]"""
    args or fail("messages <conversationId>")
    if zernio():
        return out(zhttp("GET", f"inbox/conversations/{args[0]}/messages", {"accountId": zaccount(), "limit": int(opts.get("max", 20))}))
    res = api("GET", args[0], {"fields": f"messages.limit({min(int(opts.get('max', 20)), 50)}){{id,created_time,from,to,message}}"})
    out([{"id": m["id"], "date": m.get("created_time"), "from": (m.get("from") or {}).get("username"),
          "from_id": (m.get("from") or {}).get("id"), "text": m.get("message")} for m in (res.get("messages") or {}).get("data", [])])


# ---- writes (need --yes) ----------------------------------------------------

def cmd_send(args, opts):
    """Send a DM (within 24 h of their last message): send <with_id> <text> --yes"""
    len(args) >= 2 or fail("send <with_id from dms> <text>")
    if zernio():  # with Zernio the first argument is the conversation id
        return out(zhttp("POST", f"inbox/conversations/{args[0]}/messages", body={"accountId": zaccount(), "message": " ".join(args[1:])}))
    out(api("POST", f"{ig()}/messages", body={"recipient": {"id": args[0]}, "message": {"text": " ".join(args[1:])}}))


def cmd_reply_comment(args, opts):
    """Answer a comment publicly: reply-comment <commentId> <text> --yes"""
    len(args) >= 2 or fail("reply-comment <commentId> <text>")
    zernio() and fail("with Zernio use: api POST inbox/comments/<postId> --data '{...}' (see https://docs.zernio.com/comments)")
    out(api("POST", f"{args[0]}/replies", {"message": " ".join(args[1:])}))


def cmd_hide_comment(args, opts):
    """Hide a comment (or --show to show it again): hide-comment <commentId> --yes"""
    args or fail("hide-comment <commentId>")
    zernio() and fail("with Zernio use api (see https://docs.zernio.com/comments)")
    out(api("POST", args[0], {"hide": "false" if "show" in opts else "true"}))


def cmd_publish(args, opts):
    """Publish a photo from a public link: publish <image_url> [--caption ..] --yes (reels: --video <url>)"""
    (args or opts.get("video")) or fail("publish <public image url> [--caption ..]")
    if zernio():
        item = {"type": "video", "url": opts["video"]} if opts.get("video") else {"type": "image", "url": args[0]}
        return out(zhttp("POST", "posts", body={"content": opts.get("caption", ""), "mediaItems": [item], "publishNow": True,
                                                 "platforms": [{"platform": "instagram", "accountId": zaccount()}]}))
    params = {"caption": opts.get("caption")}
    if opts.get("video"):
        params.update(media_type="REELS", video_url=opts["video"])
    else:
        params["image_url"] = args[0]
    creation = api("POST", f"{ig()}/media", params)["id"]
    for _ in range(60):  # Meta processes the file before it can go live
        status = api("GET", creation, {"fields": "status_code"}).get("status_code")
        if status in (None, "FINISHED"):
            break
        if status == "ERROR":
            fail("Meta could not process the file (check the link is public and the format is supported)")
        time.sleep(5)
    res = api("POST", f"{ig()}/media_publish", {"creation_id": creation})
    out({"id": res["id"], **api("GET", res["id"], {"fields": "permalink"})})


def cmd_api(args, opts):
    """Any call: api <METHOD> <path> [--query k=v]... [--data JSON] (the account id is in `me`: api GET <id>/stories --query fields=id,permalink)"""
    len(args) >= 2 or fail("api <METHOD> <path>")
    method = args[0].upper()
    if method != "GET" and "yes" not in opts:
        fail("this acts on the account, add --yes")
    if zernio():
        return out(zhttp(method, args[1], dict(opts["query"]) or None, json.loads(opts["data"]) if opts.get("data") else None))
    out(api(method, args[1], dict(opts["query"]) or None, json.loads(opts["data"]) if opts.get("data") else None))


COMMANDS = {name[4:].replace("_", "-"): fn for name, fn in list(globals().items()) if name.startswith("cmd_")}


def usage():
    print(f"Usage: {Path(sys.argv[0]).name} <command> [args] [--option value] [--yes]\n")
    for name, fn in COMMANDS.items():
        print(f"  {name:<14} {(fn.__doc__ or '').strip()}")


def main():
    args, opts, argv = [], {"query": []}, sys.argv[1:]
    while argv:
        a = argv.pop(0)
        if a in ("--yes", "--show", "--zernio"):
            opts[a[2:]] = True
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
        fail("this acts in the user's name: show them the exact text, get their OK, then add --yes")
    COMMANDS[cmd](rest, opts)


if __name__ == "__main__":
    main()
