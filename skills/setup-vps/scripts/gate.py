#!/usr/bin/env python3
"""Sign-in gate for expose.sh. Installed by `expose install` as the vps-gate service on 127.0.0.1:9180.

Caddy asks it about every request (forward_auth on /.gate/verify) and sends /.gate/* to it. A request passes when
its IP is on the whitelist or it carries a valid session cookie; everyone else gets the sign-in page. After signing
in, the user can save their IP so that network skips the sign-in. Mobile networks, VPNs and data centers can never
be saved, and the user must confirm the network is not a public Wi-Fi. Failed sign-ins lock the IP (5 tries, then
15 minutes, doubling up to 24 hours) and the whole sign-in page (30 failures in 15 minutes from all IPs).

Files in GATE_DATA (default /var/lib/vps-gate): login ("email bcrypt-hash"), ips (one IP or CIDR per line,
"#" comments), secret (cookie key), state.json (failure counters). The client IP comes from the X-Gate-IP header
that Caddy sets from Cloudflare's CF-Connecting-IP.
"""
import hashlib
import hmac
import html
import ipaddress
import json
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bcrypt

DATA = os.environ.get("GATE_DATA", "/var/lib/vps-gate")
PORT = int(os.environ.get("GATE_PORT", "9180"))
LOOKUP = os.environ.get("GATE_IP_LOOKUP", "http://ip-api.com/json/{ip}?fields=status,mobile,proxy,hosting,isp")
COOKIE = "vps_gate"
SESSION_SECONDS = 7 * 24 * 3600
MAX_FAILS = 5
WINDOW = 15 * 60
GLOBAL_MAX_FAILS = 30
LOCK_BASE = 15 * 60
LOCK_MAX = 24 * 3600

state_lock = threading.Lock()
lookup_cache = {}
# bcrypt of a random string, checked when the email is wrong so both cases take the same time.
DUMMY_HASH = bcrypt.hashpw(secrets.token_bytes(16), bcrypt.gensalt(12))


def path(name):
    return os.path.join(DATA, name)


def read_login():
    try:
        email, hashed = open(path("login")).read().split()[:2]
        return email, hashed
    except (OSError, ValueError):
        return None


def read_networks():
    nets = []
    try:
        for line in open(path("ips")):
            line = line.split("#", 1)[0].strip()
            if line:
                try:
                    nets.append(ipaddress.ip_network(line, strict=False))
                except ValueError:
                    pass
    except OSError:
        pass
    return nets


def ip_saved(ip):
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in read_networks())


def network_of(ip):
    addr = ipaddress.ip_address(ip)
    return str(ipaddress.ip_network(f"{ip}/{32 if addr.version == 4 else 64}", strict=False))


def secret():
    return open(path("secret"), "rb").read()


def session_key():
    login = read_login()
    # Changing the password changes the key, which signs every existing session out.
    return hmac.new(secret(), (login[1] if login else "").encode(), hashlib.sha256).digest()


def make_session():
    exp = str(int(time.time()) + SESSION_SECONDS)
    return exp + "." + hmac.new(session_key(), exp.encode(), hashlib.sha256).hexdigest()


def valid_session(token):
    if not token or "." not in token or not read_login():
        return False
    exp, mac = token.split(".", 1)
    good = hmac.new(session_key(), exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, good) and exp.isdigit() and int(exp) > time.time()


def csrf_for(token):
    return hmac.new(secret(), b"save:" + token.encode(), hashlib.sha256).hexdigest()


# Failure counters, kept on disk so a restart does not reset them.
def load_state():
    try:
        return json.load(open(path("state.json")))
    except (OSError, ValueError):
        return {}


state = {}


def save_state():
    tmp = path("state.json.tmp")
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, path("state.json"))


def locked_for(ip):
    """Seconds left before this IP may try again (0 when it may)."""
    now = time.time()
    with state_lock:
        until = max(state.get("ips", {}).get(ip, {}).get("until", 0), state.get("global_until", 0))
    return max(0, int(until - now))


def record_failure(ip):
    now = time.time()
    with state_lock:
        ips = state.setdefault("ips", {})
        entry = ips.setdefault(ip, {"fails": [], "locks": 0, "until": 0})
        entry["fails"] = [t for t in entry["fails"] if now - t < WINDOW] + [now]
        if len(entry["fails"]) >= MAX_FAILS:
            entry["until"] = now + min(LOCK_BASE * 2 ** entry["locks"], LOCK_MAX)
            entry["locks"] += 1
            entry["fails"] = []
        recent = [t for t in state.get("recent", []) if now - t < WINDOW] + [now]
        state["recent"] = recent
        if len(recent) >= GLOBAL_MAX_FAILS:
            state["global_until"] = now + LOCK_BASE
            state["recent"] = []
        # Forget IPs that are neither locked nor recently failing.
        for key in [k for k, v in ips.items() if v["until"] < now and not v["fails"] and now - v.get("seen", now) > LOCK_MAX]:
            del ips[key]
        entry["seen"] = now
        save_state()


def clear_failures(ip):
    with state_lock:
        entry = state.get("ips", {}).get(ip)
        if entry:
            entry["fails"] = []
            save_state()


def network_check(ip):
    """(can_save, isp, reason). Mobile networks, VPNs, proxies and data centers can never be saved."""
    cached = lookup_cache.get(ip)
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    try:
        if not ipaddress.ip_address(ip).is_global:
            result = (False, "", "private")
        else:
            with urllib.request.urlopen(LOOKUP.format(ip=urllib.parse.quote(ip)), timeout=5) as r:
                info = json.load(r)
            if info.get("status") != "success":
                result = (False, "", "unknown")
            elif info.get("mobile"):
                result = (False, info.get("isp", ""), "mobile")
            elif info.get("proxy") or info.get("hosting"):
                result = (False, info.get("isp", ""), "vpn")
            else:
                result = (True, info.get("isp", ""), "")
    except Exception:
        result = (False, "", "unknown")
    lookup_cache[ip] = (time.time(), result)
    return result


TEXT = {
    "fr": {
        "title": "Connexion",
        "email": "Email",
        "password": "Mot de passe",
        "submit": "Se connecter",
        "bad": "Email ou mot de passe incorrect.",
        "locked": "Trop d'essais. Réessaie dans {m} min.",
        "nologin": "Aucun accès configuré sur ce serveur.",
        "save_title": "Sauvegarder cette IP ?",
        "save_text": "Depuis {ip}{isp}, tu n'auras plus besoin de te connecter.",
        "confirm": "C'est mon réseau perso (maison ou bureau), pas un Wi-Fi public (café, hôtel, coworking, aéroport, gare).",
        "save": "Sauvegarder cette IP",
        "skip": "Continuer sans sauvegarder",
        "need_confirm": "Coche la case : un Wi-Fi public ne doit jamais être sauvegardé.",
        "refused": "Cette IP ne peut pas être sauvegardée ({why}).",
        "why_mobile": "réseau mobile partagé",
        "why_vpn": "VPN ou serveur",
        "why_unknown": "réseau impossible à vérifier",
        "why_private": "adresse privée",
    },
    "en": {
        "title": "Sign in",
        "email": "Email",
        "password": "Password",
        "submit": "Sign in",
        "bad": "Wrong email or password.",
        "locked": "Too many tries. Try again in {m} min.",
        "nologin": "No access is set up on this server.",
        "save_title": "Save this IP?",
        "save_text": "From {ip}{isp}, you will not need to sign in anymore.",
        "confirm": "This is my own network (home or office), not a public Wi-Fi (cafe, hotel, coworking, airport, station).",
        "save": "Save this IP",
        "skip": "Continue without saving",
        "need_confirm": "Tick the box: a public Wi-Fi must never be saved.",
        "refused": "This IP cannot be saved ({why}).",
        "why_mobile": "shared mobile network",
        "why_vpn": "VPN or server",
        "why_unknown": "network could not be checked",
        "why_private": "private address",
    },
}

STYLE = """
:root{color-scheme:light dark;--bg:#f6f6f4;--card:#fff;--fg:#1b1b1a;--muted:#6b6b66;--line:#deded8;--accent:#1b1b1a;--accent-fg:#fff;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#1c1c1b;--fg:#ececea;--muted:#9a9a94;--line:#2e2e2c;--accent:#ececea;--accent-fg:#121211;--err:#f97066}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
main{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 18px}label{display:block;font-size:13px;color:var(--muted);margin:12px 0 4px}
input[type=email],input[type=password]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
button{width:100%;margin-top:18px;padding:11px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-fg);font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--fg);border:1px solid var(--line);margin-top:8px}
.check{display:flex;gap:10px;align-items:flex-start;margin-top:16px;font-size:14px;color:var(--fg)}.check input{margin-top:4px}
.err{color:var(--err);font-size:14px;margin:0 0 8px}p{margin:0 0 8px}.muted{color:var(--muted);font-size:14px}
"""


def safe_next(value):
    value = value or "/"
    if not value.startswith("/") or value.startswith("//") or value.startswith("/\\") or value.startswith("/.gate/"):
        return "/"
    return value


class Gate(BaseHTTPRequestHandler):
    server_version = "gate"
    sys_version = ""

    def log_message(self, fmt, *args):
        pass

    def log(self, msg):
        print(f"{msg} ip={self.ip}", flush=True)

    @property
    def ip(self):
        return (self.headers.get("X-Gate-IP") or "").strip()

    @property
    def t(self):
        lang = (self.headers.get("Accept-Language") or "").lower()
        return TEXT["fr" if lang.startswith("fr") else "en"]

    def session(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie") or "")
        except Exception:
            return None
        morsel = cookie.get(COOKIE)
        return morsel.value if morsel and valid_session(morsel.value) else None

    def send(self, code, body="", headers=None):
        data = body.encode()
        self.send_response(code)
        self.send_header("Cache-Control", "no-store")
        if body:
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
            self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def page(self, code, title, inner, headers=None):
        self.send(code, f'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                        f'<meta name="robots" content="noindex"><title>{html.escape(title)}</title><style>{STYLE}</style></head>'
                        f'<body><main><h1>{html.escape(title)}</h1>{inner}</main></body></html>', headers)

    def login_page(self, code=200, error="", nxt="/"):
        t = self.t
        wait = locked_for(self.ip)
        if wait:
            error, code = t["locked"].format(m=max(1, (wait + 59) // 60)), 429
        if not read_login():
            error = t["nologin"]
        err = f'<p class="err">{html.escape(error)}</p>' if error else ""
        self.page(code, t["title"], f'{err}<form method="post" action="/.gate/login">'
                  f'<input type="hidden" name="next" value="{html.escape(nxt)}">'
                  f'<label for="e">{t["email"]}</label><input id="e" type="email" name="email" autocomplete="username" required autofocus>'
                  f'<label for="p">{t["password"]}</label><input id="p" type="password" name="password" autocomplete="current-password" required>'
                  f'<button>{t["submit"]}</button></form>')

    def save_page(self, token, nxt, isp, error=""):
        t = self.t
        err = f'<p class="err">{html.escape(error)}</p>' if error else ""
        isp_text = f" ({isp})" if isp else ""
        self.page(200, t["save_title"], f'{err}<p>{html.escape(t["save_text"].format(ip=self.ip, isp=isp_text))}</p>'
                  f'<form method="post" action="/.gate/save"><input type="hidden" name="next" value="{html.escape(nxt)}">'
                  f'<input type="hidden" name="csrf" value="{csrf_for(token)}">'
                  f'<label class="check"><input type="checkbox" name="private" value="yes"><span>{html.escape(t["confirm"])}</span></label>'
                  f'<button name="action" value="save">{t["save"]}</button>'
                  f'<button class="ghost" name="action" value="skip">{t["skip"]}</button></form>',
                  {"Set-Cookie": self.cookie(token)})

    def cookie(self, token, max_age=SESSION_SECONDS):
        return f"{COOKIE}={token}; Path=/; Max-Age={max_age}; HttpOnly; Secure; SameSite=Lax"

    def form(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 4096:
            return {}
        return {k: v[0] for k, v in urllib.parse.parse_qs(self.rfile.read(length).decode(errors="replace")).items()}

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if not self.ip:
            return self.send(403)
        if url.path == "/.gate/verify":
            if ip_saved(self.ip) or self.session():
                return self.send(204)
            nxt = safe_next(self.headers.get("X-Forwarded-Uri"))
            if (self.headers.get("X-Forwarded-Method") or "GET") in ("GET", "HEAD"):
                return self.send(302, headers={"Location": "/.gate/login?next=" + urllib.parse.quote(nxt, safe="")})
            return self.send(401)
        if url.path == "/.gate/login":
            nxt = safe_next(urllib.parse.parse_qs(url.query).get("next", ["/"])[0])
            if self.session() or ip_saved(self.ip):
                return self.send(302, headers={"Location": nxt})
            return self.login_page(nxt=nxt)
        if url.path == "/.gate/logout":
            return self.send(302, headers={"Location": "/.gate/login", "Set-Cookie": self.cookie("", 0)})
        return self.send(404)

    def do_POST(self):
        url = urllib.parse.urlsplit(self.path)
        if not self.ip:
            return self.send(403)
        f = self.form()
        nxt = safe_next(f.get("next"))
        if url.path == "/.gate/login":
            if locked_for(self.ip):
                return self.login_page(nxt=nxt)
            login = read_login()
            email = (f.get("email") or "").strip().lower()
            password = (f.get("password") or "").encode()[:200]
            email_ok = bool(login) and hmac.compare_digest(email.encode(), login[0].lower().encode())
            try:
                password_ok = bcrypt.checkpw(password, (login[1] if email_ok else DUMMY_HASH.decode()).encode())
            except ValueError:
                password_ok = False
            if not (email_ok and password_ok):
                record_failure(self.ip)
                self.log("sign-in failed")
                time.sleep(1)
                return self.login_page(401, self.t["bad"], nxt)
            clear_failures(self.ip)
            self.log("sign-in ok")
            token = make_session()
            if not ip_saved(self.ip):
                can_save, isp, _ = network_check(self.ip)
                if can_save:
                    return self.save_page(token, nxt, isp)
            return self.send(302, headers={"Location": nxt, "Set-Cookie": self.cookie(token)})
        if url.path == "/.gate/save":
            token = self.session()
            if not token or not hmac.compare_digest(f.get("csrf", ""), csrf_for(token)):
                return self.send(302, headers={"Location": "/.gate/login?next=" + urllib.parse.quote(nxt, safe="")})
            if f.get("action") != "save":
                return self.send(302, headers={"Location": nxt})
            can_save, isp, why = network_check(self.ip)
            if not can_save:
                return self.page(200, self.t["save_title"], f'<p class="err">{html.escape(self.t["refused"].format(why=self.t["why_" + why]))}</p>'
                                 f'<p><a href="{html.escape(nxt)}">{html.escape(self.t["skip"])}</a></p>')
            if f.get("private") != "yes":
                return self.save_page(token, nxt, isp, self.t["need_confirm"])
            if not ip_saved(self.ip):
                with state_lock, open(path("ips"), "a") as out:
                    out.write(f"{network_of(self.ip)} # saved from the sign-in page {time.strftime('%Y-%m-%d')} {isp}\n")
            self.log("ip saved")
            return self.send(302, headers={"Location": nxt})
        return self.send(404)


if __name__ == "__main__":
    state = load_state()
    if not os.path.exists(path("secret")):
        with open(path("secret"), "wb") as out:
            out.write(secrets.token_bytes(32))
        os.chmod(path("secret"), 0o600)
    ThreadingHTTPServer(("127.0.0.1", PORT), Gate).serve_forever()
