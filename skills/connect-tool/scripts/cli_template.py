#!/usr/bin/env python3
"""TOOL CLI: one file, Python 3 standard library only. Made with connect-tool."""

import getpass, json, os, re, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

# Fill these from the official API docs.
TOOL = "tool"  # lowercase, dashes
ENV_KEY = "TOOL_API_KEY"
BASE_URL = "https://api.example.com/v1"  # may use {setting}, e.g. https://{subdomain}.example.com/api/v2
KEY_URL = "https://example.com/settings/api"  # where the user creates the key
SETTINGS = {}  # extra values asked by login, e.g. {"subdomain": "Your subdomain (before .example.com)"}


def auth_headers(key):
    return {"Authorization": f"Bearer {key}"}  # or {"X-API-Key": key}


# name: (METHOD, path, help). {0}, {1} = positional args, {setting} = saved setting.
COMMANDS = {
    "check": ("GET", "/me", "Check the key works"),
    # "contacts:list": ("GET", "/contacts", "List contacts"),
    # "contacts:get": ("GET", "/contacts/{0}", "Get a contact: contacts:get <id>"),
    # "contacts:create": ("POST", "/contacts", "Create a contact: --data '{\"email\": \"a@b.com\"}'"),
}

CONFIG = Path.home() / ".config" / f"{TOOL}-cli" / "config.json"


def fail(msg):
    sys.exit(f"Error: {msg}")


def load():
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else {}


def save(cfg):
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(CONFIG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(cfg, f, indent=2)
    CONFIG.chmod(0o600)


def fill(template, args, cfg):
    def sub(m):
        name = m.group(1)
        value = args[int(name)] if name.isdigit() and int(name) < len(args) else cfg.get(name)
        if value is None:
            fail(f"missing {'argument ' + str(int(name) + 1) if name.isdigit() else name}")
        return urllib.parse.quote(str(value), safe="")
    return re.sub(r"\{(\w+)\}", sub, template)


def call(method, path, args, opts):
    cfg = load()
    key = os.environ.get(ENV_KEY) or cfg.get("api_key")
    if not key:
        fail(f"no API key. Run: login (create one at {KEY_URL})")
    if method == "DELETE" and "yes" not in opts:
        fail("this deletes data, add --yes")
    url = fill(BASE_URL, [], cfg).rstrip("/") + fill(path, args, cfg)
    if opts.get("query"):
        url += "?" + urllib.parse.urlencode(opts["query"])
    data = opts.get("data")
    if data == "-":
        data = sys.stdin.read()
    headers = {"Accept": "application/json", "User-Agent": f"{TOOL}-cli", **auth_headers(key)}
    if data:
        try:
            data = json.dumps(json.loads(data)).encode()
        except ValueError:
            fail("--data must be valid JSON")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data or None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as res:
            body, ok = res.read().decode(), True
    except urllib.error.HTTPError as e:
        body, ok = e.read().decode(), False
        print(f"HTTP {e.code} on {method} {path}", file=sys.stderr)
    try:
        body = json.dumps(json.loads(body), indent=2, ensure_ascii=False)
    except ValueError:
        pass
    print(body, file=sys.stdout if ok else sys.stderr)
    sys.exit(0 if ok else 1)


def login(opts):
    cfg = load()
    if sys.stdin.isatty():
        print(f"Create your key here: {KEY_URL}")
        cfg["api_key"] = getpass.getpass("API key (hidden): ").strip()
    else:
        cfg["api_key"] = sys.stdin.read().strip()  # printf '%s' "$KEY" | tool.py login
    for name, question in SETTINGS.items():
        cfg[name] = opts.get(name) or (input(question + ": ").strip() if sys.stdin.isatty() else cfg.get(name))
    if not cfg["api_key"] or not all(cfg.get(n) for n in SETTINGS):
        fail(f"missing key or setting ({', '.join(['key', *SETTINGS])})")
    save(cfg)
    print(f"Saved to {CONFIG}")
    call(*COMMANDS["check"][:2], [], {})


def usage():
    rows = [("login", "Save the API key" + (" and " + ", ".join(SETTINGS) if SETTINGS else "")),
            ("logout", "Forget the key"),
            *((n, c[2]) for n, c in COMMANDS.items()),
            ("api", "api <METHOD> <path> (any endpoint)")]
    print(f"Usage: {sys.argv[0]} <command> [args] [--data JSON|-] [--query k=v] [--yes]\n")
    print("\n".join(f"  {n:<20} {h}" for n, h in rows))


def main():
    args, opts, argv = [], {"query": []}, sys.argv[1:]
    while argv:
        a = argv.pop(0)
        if a == "--yes":
            opts["yes"] = True
        elif a.startswith("--"):
            name, _, value = a[2:].partition("=")
            value = value or (argv.pop(0) if argv else fail(f"--{name} needs a value"))
            if name == "query":
                opts["query"].append(tuple(value.split("=", 1) + [""])[:2])
            else:
                opts[name] = value
        else:
            args.append(a)
    cmd, rest = (args[0], args[1:]) if args else ("help", [])
    if cmd == "login":
        login(opts)
    elif cmd == "logout":
        CONFIG.unlink(missing_ok=True)
        print("Key removed.")
    elif cmd == "api" and len(rest) >= 2:
        call(rest[0].upper(), "/" + rest[1].lstrip("/"), rest[2:], opts)
    elif cmd in COMMANDS:
        call(*COMMANDS[cmd][:2], rest, opts)
    else:
        usage()


if __name__ == "__main__":
    main()
