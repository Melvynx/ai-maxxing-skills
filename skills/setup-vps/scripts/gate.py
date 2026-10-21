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
        "sub": "Espace privé de {host}.",
        "email": "Email",
        "password": "Mot de passe",
        "submit": "Se connecter",
        "foot": "Session signée · {n} essais par {m} min",
        "save_sub": "Ce réseau n'aura plus besoin de mot de passe.",
        "refused_sub": "Ta session reste valable 7 jours sur cet appareil.",
        "network": "Réseau",
        "server": "ce serveur",
        "bad": "Email ou mot de passe incorrect.",
        "locked": "Trop d'essais. Réessaie dans {m} min.",
        "nologin": "Aucun accès configuré sur ce serveur.",
        "save_title": "Sauvegarder cette IP ?",
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
        "sub": "Private area of {host}.",
        "email": "Email",
        "password": "Password",
        "submit": "Sign in",
        "foot": "Signed session · {n} tries per {m} min",
        "save_sub": "This network will not need the password anymore.",
        "refused_sub": "Your session stays valid for 7 days on this device.",
        "network": "Network",
        "server": "this server",
        "bad": "Wrong email or password.",
        "locked": "Too many tries. Try again in {m} min.",
        "nologin": "No access is set up on this server.",
        "save_title": "Save this IP?",
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

FONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geist.woff2")
ICON = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs><rect width="32" height="32" rx="7.5" fill="url(#g)"/>'
        '<rect x="8" y="8.5" width="4.5" height="16" rx="1.5" fill="#fff"/><rect x="19.5" y="8.5" width="4.5" height="16" rx="1.5" fill="#fff"/>'
        '<rect x="11" y="14.75" width="10" height="3.5" rx="1.2" fill="#e0e7ff"/><path d="M24 10.4c2.6-.2 4.2-1.5 4.9-3.6-2.2.5-3.8.4-4.9-.2z" fill="#c7d2fe"/>'
        '<path d="M8 10.4c-2.6-.2-4.2-1.5-4.9-3.6 2.2.5 3.8.4 4.9-.2z" fill="#c7d2fe"/></svg>')
FAVICON = "data:image/svg+xml," + urllib.parse.quote(ICON.replace(' aria-hidden="true"', ""))
CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"

DARK = """--bg:oklch(0.141 0.005 285.823);--fg:oklch(0.967 0.003 286);--card:oklch(0.177 0.006 286);--muted:oklch(0.235 0.006 286);
--muted-fg:oklch(0.715 0.014 286);--border:oklch(1 0 0 / 8%);--input:oklch(1 0 0 / 14%);--ring:oklch(0.673 0.182 276.935);
--primary:oklch(0.92 0.004 286.32);--primary-fg:oklch(0.21 0.006 285.885);--brand-ink:oklch(0.785 0.115 274.713);--brand-soft:oklch(0.585 0.233 277.117 / 14%);
--bad:oklch(0.75 0.16 22);--bad-soft:oklch(0.637 0.237 25.331 / 11%);--bad-line:oklch(0.637 0.237 25.331 / 34%);
--shadow:0 1px 2px oklch(0 0 0 / 30%),0 12px 32px -12px oklch(0 0 0 / 60%)"""
STYLE = """
@font-face{font-family:"Geist Variable";font-style:normal;font-display:swap;font-weight:100 900;src:url(/.gate/geist.woff2) format("woff2-variations")}
:root{color-scheme:light;--bg:oklch(0.984 0.002 286);--fg:oklch(0.16 0.006 286);--card:oklch(1 0 0);--muted:oklch(0.962 0.003 286);
--muted-fg:oklch(0.5 0.014 286);--border:oklch(0.915 0.004 286);--input:oklch(0.88 0.006 286);--ring:oklch(0.585 0.233 277.117);
--primary:oklch(0.21 0.006 285.885);--primary-fg:oklch(0.985 0 0);--brand-ink:oklch(0.457 0.24 277.023);--brand-soft:oklch(0.962 0.018 272.314);
--bad:oklch(0.505 0.213 27.518);--bad-soft:oklch(0.971 0.013 17.38);--bad-line:oklch(0.885 0.062 18.334);
--shadow:0 1px 2px oklch(0 0 0 / 4%),0 8px 24px -8px oklch(0 0 0 / 10%)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;""" + DARK + """}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100dvh;background:var(--bg);color:var(--fg);font:14px/1.5 "Geist Variable",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
body{display:grid;place-items:center;padding:24px 16px}
main{width:min(100%,380px);display:grid;gap:20px}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;letter-spacing:-0.01em}
.brand svg{width:28px;height:28px;flex:none}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:24px;box-shadow:var(--shadow);display:grid;gap:18px}
h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-0.02em}
.sub{margin:4px 0 0;color:var(--muted-fg);overflow-wrap:anywhere}
form{display:grid;gap:14px;margin:0}
label{display:grid;gap:6px;font-weight:500;font-size:13px}
input[type=email],input[type=password]{width:100%;height:38px;padding:0 12px;border-radius:8px;border:1px solid var(--input);background:transparent;color:inherit;font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus-visible{border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklch,var(--ring) 25%,transparent)}
.check{display:flex;align-items:flex-start;gap:8px;font-weight:400;color:var(--muted-fg);font-size:13px;cursor:pointer;padding:12px;border:1px solid var(--border);border-radius:10px}
.check input{margin:2px 0 0;accent-color:var(--ring);width:15px;height:15px;flex:none}
.actions{display:grid;gap:8px}
button,.btn{height:38px;padding:0 14px;border:0;border-radius:8px;background:var(--primary);color:var(--primary-fg);font:inherit;font-weight:500;cursor:pointer;transition:opacity .15s,background .15s;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
button:hover,.btn:hover{opacity:.9}
button:focus-visible,.btn:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
.ghost{background:transparent;color:var(--fg);border:1px solid var(--border)}
.ghost:hover{background:var(--muted);opacity:1}
.alert{padding:10px 12px;border-radius:8px;border:1px solid var(--bad-line);background:var(--bad-soft);color:var(--bad);font-size:13px}
.net{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-radius:10px;background:var(--muted)}
.net span{color:var(--muted-fg);font-size:12px}
.net b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;background:var(--brand-soft);color:var(--brand-ink);font:500 12px ui-monospace,"SF Mono",Menlo,monospace;white-space:nowrap}
.dot{width:6px;height:6px;border-radius:99px;background:currentColor}
.foot{margin:0;color:var(--muted-fg);font-size:12px;text-align:center}
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
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    @property
    def host(self):
        return (self.headers.get("Host") or "").split(":")[0].lower() or self.t["server"]

    def page(self, code, title, card, headers=None):
        lang = "fr" if self.t is TEXT["fr"] else "en"
        foot = self.t["foot"].format(n=MAX_FAILS, m=WINDOW // 60)
        self.send(code, f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                        f'<meta name="robots" content="noindex"><title>{html.escape(title)}</title><link rel="icon" href="{FAVICON}">'
                        f'<style>{STYLE}</style></head><body><main><div class="brand">{ICON}<span>Hermes</span></div>'
                        f'<section class="card">{card}</section><p class="foot">{html.escape(foot)}</p></main></body></html>', headers)

    def heading(self, title, sub):
        return f'<div><h1>{html.escape(title)}</h1><p class="sub">{html.escape(sub)}</p></div>'

    @staticmethod
    def alert(error):
        return f'<div class="alert" role="alert">{html.escape(error)}</div>' if error else ""

    def login_page(self, code=200, error="", nxt="/"):
        t = self.t
        wait = locked_for(self.ip)
        if wait:
            error, code = t["locked"].format(m=max(1, (wait + 59) // 60)), 429
        if not read_login():
            error = t["nologin"]
        self.page(code, t["title"], self.heading(t["title"], t["sub"].format(host=self.host)) + self.alert(error)
                  + f'<form method="post" action="/.gate/login"><input type="hidden" name="next" value="{html.escape(nxt)}">'
                  f'<label>{t["email"]}<input type="email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>'
                  f'<label>{t["password"]}<input type="password" name="password" autocomplete="current-password" required></label>'
                  f'<button type="submit">{t["submit"]}</button></form>')

    def network_row(self, isp):
        return (f'<div class="net"><div style="display:grid;min-width:0"><span>{self.t["network"]}</span><b>{html.escape(isp or "?")}</b></div>'
                f'<span class="pill"><span class="dot"></span>{html.escape(self.ip)}</span></div>')

    def save_page(self, token, nxt, isp, error=""):
        t = self.t
        self.page(200, t["save_title"], self.heading(t["save_title"], t["save_sub"]) + self.alert(error) + self.network_row(isp)
                  + f'<form method="post" action="/.gate/save"><input type="hidden" name="next" value="{html.escape(nxt)}">'
                  f'<input type="hidden" name="csrf" value="{csrf_for(token)}">'
                  f'<label class="check"><input type="checkbox" name="private" value="yes"><span>{html.escape(t["confirm"])}</span></label>'
                  f'<div class="actions"><button name="action" value="save">{t["save"]}</button>'
                  f'<button class="ghost" name="action" value="skip">{t["skip"]}</button></div></form>',
                  {"Set-Cookie": self.cookie(token)})

    def refused_page(self, nxt, isp, why):
        t = self.t
        self.page(200, t["save_title"], self.heading(t["save_title"], t["refused_sub"]) + self.network_row(isp)
                  + self.alert(t["refused"].format(why=t["why_" + why]))
                  + f'<a class="btn ghost" href="{html.escape(nxt)}">{html.escape(t["skip"])}</a>')

    def font(self):
        try:
            with open(FONT, "rb") as f:
                data = f.read()
        except OSError:
            return self.send(404)
        self.send_response(200)
        self.send_header("Content-Type", "font/woff2")
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def cookie(self, token, max_age=SESSION_SECONDS):
        return f"{COOKIE}={token}; Path=/; Max-Age={max_age}; HttpOnly; Secure; SameSite=Lax"

    def form(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 4096:
            return {}
        return {k: v[0] for k, v in urllib.parse.parse_qs(self.rfile.read(length).decode(errors="replace")).items()}

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/.gate/geist.woff2":
            return self.font()
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
                return self.refused_page(nxt, isp, why)
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
