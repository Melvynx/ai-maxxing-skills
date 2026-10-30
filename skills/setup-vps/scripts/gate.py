#!/usr/bin/env python3
"""Sign-in gate for expose.sh. Installed by `expose install` as the vps-gate service on 127.0.0.1:9180.

Caddy asks it about every request (forward_auth on /.gate/verify) and sends /.gate/* to it. A request passes when
it carries a valid session cookie or its IP is on the whitelist; everyone else gets the sign-in page.

Two ways to sign in. With a Lumail key (the `lumail` file), people sign in with their email and a 6-digit code sent
by Lumail: every email in `users` can sign in, as `admin` (every site) or `member` (the sites not kept for admins,
asked with /.gate/verify?need=admin). Without it, the one `login` email and password of the owner, who is admin.
The answer to Caddy carries X-Gate-User and X-Gate-Role, so the app behind knows who is there.

After signing in, an admin can save their IP so that network skips the sign-in (it then counts as admin). Mobile
networks, VPNs and data centers can never be saved, and the user must confirm the network is not a public Wi-Fi.
Wrong codes or passwords lock the IP (5 tries, then 15 minutes, doubling up to 24 hours) and the whole sign-in page
(30 failures in 15 minutes from all IPs). A code lasts 10 minutes and dies after 5 wrong tries.

Files in GATE_DATA (default /var/lib/vps-gate): users ("email role" per line), lumail ("key=lum_..." and
"from=Name <address>"), login ("email bcrypt-hash"), ips (one IP or CIDR per line, "#" comments), secret (cookie
key), state.json (failure counters). The client IP comes from the X-Gate-IP header that Caddy sets from
Cloudflare's CF-Connecting-IP.

`gate.py test-mail <from> <to>` (Lumail key on stdin) and `gate.py invite <to> <url>...` send one email and exit.
"""
import base64
import hashlib
import hmac
import html
import ipaddress
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
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
LUMAIL_API = os.environ.get("GATE_LUMAIL_API", "https://lumail.io/api/v1/emails")
CODE_SECONDS = 10 * 60
CODE_TRIES = 5
# Codes sent to one email: one every 30 seconds, 5 an hour. And 60 an hour for the whole server.
RESEND_SECONDS = 30
SENDS_PER_HOUR = 5
GLOBAL_SENDS_PER_HOUR = 60
ROLES = ("admin", "member")
EMAIL_RE = re.compile(r"^[^@\s<>\"']+@[^@\s<>\"']+\.[^@\s<>\"']+$")

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


def read_users():
    """{email: role} of everyone who may sign in with a code."""
    users = {}
    try:
        for line in open(path("users")):
            parts = line.split("#", 1)[0].split()
            if len(parts) >= 2 and parts[1] in ROLES:
                users[parts[0].lower()] = parts[1]
    except OSError:
        pass
    return users


def read_lumail():
    """(key, from) when sign-in codes are on, else None."""
    conf = {}
    try:
        for line in open(path("lumail")):
            key, _, value = line.strip().partition("=")
            conf[key] = value
    except OSError:
        return None
    return (conf["key"], conf["from"]) if conf.get("key") and conf.get("from") else None


def code_mode():
    return read_lumail() is not None


def role_of(email):
    """The role of a signed-in email, or None when it may not sign in anymore."""
    if code_mode():
        return read_users().get(email)
    login = read_login()
    return "admin" if login and hmac.compare_digest(email.encode(), login[0].lower().encode()) else None


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
    if code_mode():
        # Removing someone from users signs them out (role_of), switching modes signs everyone out.
        return hmac.new(secret(), b"code", hashlib.sha256).digest()
    login = read_login()
    # Changing the password changes the key, which signs every existing session out.
    return hmac.new(secret(), b"password:" + (login[1] if login else "").encode(), hashlib.sha256).digest()


def session_mac(email, exp):
    return hmac.new(session_key(), f"{email}|{exp}".encode(), hashlib.sha256).hexdigest()


def make_session(email):
    exp = str(int(time.time()) + SESSION_SECONDS)
    who = base64.urlsafe_b64encode(email.encode()).decode().rstrip("=")
    return f"{who}.{exp}.{session_mac(email, exp)}"


def valid_session(token):
    """(email, role) of a valid session token, else None."""
    try:
        who, exp, mac = token.split(".")
        email = base64.urlsafe_b64decode(who + "=" * (-len(who) % 4)).decode()
    except (AttributeError, ValueError, UnicodeDecodeError):
        return None
    if not exp.isdigit() or int(exp) <= time.time() or not hmac.compare_digest(mac, session_mac(email, exp)):
        return None
    role = role_of(email)
    return (email, role) if role else None


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


# Sign-in codes waiting to be typed, in memory only: a restart only means asking for a new code.
codes = {}
sends = {"all": []}


def code_digest(email, code):
    return hmac.new(secret(), f"code:{email}:{code}".encode(), hashlib.sha256).hexdigest()


def new_code(email):
    """A fresh code for this email, or None when it asked too often (the last code stays valid)."""
    now = time.time()
    with state_lock:
        mine = [t for t in sends.get(email, []) if now - t < 3600]
        everyone = [t for t in sends["all"] if now - t < 3600]
        if (mine and now - mine[-1] < RESEND_SECONDS) or len(mine) >= SENDS_PER_HOUR or len(everyone) >= GLOBAL_SENDS_PER_HOUR:
            return None
        sends[email], sends["all"] = mine + [now], everyone + [now]
        code = f"{secrets.randbelow(10 ** 6):06d}"
        codes[email] = {"digest": code_digest(email, code), "until": now + CODE_SECONDS, "tries": 0}
        return code


def check_code(email, code):
    with state_lock:
        entry = codes.get(email)
        if not entry or entry["until"] < time.time():
            codes.pop(email, None)
            return False
        if hmac.compare_digest(entry["digest"], code_digest(email, code)):
            del codes[email]
            return True
        entry["tries"] += 1
        if entry["tries"] >= CODE_TRIES:
            del codes[email]
        return False


def send_email(key, sender, to, subject, content):
    """Send one email through Lumail. Raises with Lumail's message when it refuses (never with the key)."""
    body = json.dumps({"from": sender, "to": to, "subject": subject, "content": content, "contentType": "MARKDOWN", "transactional": True}).encode()
    req = urllib.request.Request(LUMAIL_API, body, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            r.read()
    except urllib.error.HTTPError as e:
        try:
            detail = json.load(e).get("message") or e.reason
        except Exception:
            detail = e.reason
        raise RuntimeError(f"Lumail refused the email ({e.code}): {detail}") from None


def send_code(email, code, host, t):
    lumail = read_lumail()
    if not lumail:
        return
    try:
        send_email(lumail[0], lumail[1], email, t["mail_subject"].format(code=code, host=host), t["mail_body"].format(code=code, host=host, m=CODE_SECONDS // 60))
        print(f"code sent to {email}", flush=True)
    except Exception as e:
        print(f"code not sent to {email}: {e}", flush=True)


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
        "code_sub": "Entre ton email : tu reçois un code de connexion.",
        "send": "Recevoir un code",
        "code_title": "Vérifie tes emails",
        "code_sent": "Si {email} a accès à {host}, un code à 6 chiffres vient d'y être envoyé. Il expire dans {m} min.",
        "code": "Code",
        "bad_code": "Code incorrect ou expiré.",
        "bad_email": "Cet email n'est pas valide.",
        "other": "Utiliser un autre email ou renvoyer un code",
        "code_foot": "Code à usage unique · {n} essais par {m} min",
        "denied_title": "Accès réservé",
        "denied_sub": "Ton compte ({email}) n'a pas accès à {host}. Demande à un admin de te le donner.",
        "logout": "Se déconnecter",
        "mail_subject": "{code} est ton code de connexion",
        "mail_body": "Ton code de connexion à **{host}** :\n\n# {code}\n\nIl expire dans {m} minutes. Si tu n'as rien demandé, ignore cet email : personne ne peut entrer sans ce code.",
        "invite_subject": "Tu as accès à {host}",
        "invite_body": "Tu as maintenant accès à :\n\n{sites}\n\nOuvre le lien et entre ton email ({email}) : tu reçois un code de connexion à chaque fois, sans mot de passe.",
        "test_subject": "La connexion par email est prête",
        "test_body": "Cet email confirme que ton serveur peut envoyer les codes de connexion. Désormais, tu te connectes avec ton email ({email}) et un code reçu ici.",
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
        "code_sub": "Enter your email: you get a sign-in code.",
        "send": "Get a code",
        "code_title": "Check your email",
        "code_sent": "If {email} has access to {host}, a 6-digit code was just sent to it. It expires in {m} min.",
        "code": "Code",
        "bad_code": "Wrong or expired code.",
        "bad_email": "This email is not valid.",
        "other": "Use another email or resend a code",
        "code_foot": "One-time code · {n} tries per {m} min",
        "denied_title": "Restricted access",
        "denied_sub": "Your account ({email}) has no access to {host}. Ask an admin to give it to you.",
        "logout": "Sign out",
        "mail_subject": "{code} is your sign-in code",
        "mail_body": "Your sign-in code for **{host}**:\n\n# {code}\n\nIt expires in {m} minutes. If you did not ask for it, ignore this email: nobody gets in without this code.",
        "invite_subject": "You have access to {host}",
        "invite_body": "You now have access to:\n\n{sites}\n\nOpen the link and enter your email ({email}): you get a sign-in code each time, no password.",
        "test_subject": "Email sign-in is ready",
        "test_body": "This email confirms your server can send sign-in codes. From now on, you sign in with your email ({email}) and a code sent here.",
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
input[type=email],input[type=password],input[inputmode=numeric]{width:100%;height:38px;padding:0 12px;border-radius:8px;border:1px solid var(--input);background:transparent;color:inherit;font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
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
.code{font:600 22px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.35em;text-align:center;height:48px!important}
.link{color:var(--muted-fg);font-size:13px;text-align:center;text-decoration:underline;text-underline-offset:3px}
.link:hover{color:var(--fg)}
.foot{margin:0;color:var(--muted-fg);font-size:12px;text-align:center}
"""


def safe_next(value):
    value = value or "/"
    # Browsers drop tabs and newlines and read "\" as "/", so "/\t/evil.com" would land on //evil.com.
    if any(ord(c) < 0x21 or c in "\\\x7f" for c in value):
        return "/"
    parts = urllib.parse.urlsplit(value)
    if parts.scheme or parts.netloc or not value.startswith("/") or value.startswith("//") or value.startswith("/.gate/"):
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
        """(token, email, role) of the visitor's valid session, else None."""
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie") or "")
        except Exception:
            return None
        morsel = cookie.get(COOKIE)
        who = valid_session(morsel.value) if morsel else None
        return (morsel.value, *who) if who else None

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
            self.send_header(key, str(value).replace("\r", "").replace("\n", ""))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    @property
    def host(self):
        return (self.headers.get("Host") or "").split(":")[0].lower() or self.t["server"]

    def page(self, code, title, card, headers=None):
        lang = "fr" if self.t is TEXT["fr"] else "en"
        foot = self.t["code_foot" if code_mode() else "foot"].format(n=MAX_FAILS, m=WINDOW // 60)
        self.send(code, f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                        f'<meta name="robots" content="noindex"><title>{html.escape(title)}</title><link rel="icon" href="{FAVICON}">'
                        f'<style>{STYLE}</style></head><body><main><div class="brand">{ICON}<span>Hermes</span></div>'
                        f'<section class="card">{card}</section><p class="foot">{html.escape(foot)}</p></main></body></html>', headers)

    def heading(self, title, sub):
        return f'<div><h1>{html.escape(title)}</h1><p class="sub">{html.escape(sub)}</p></div>'

    @staticmethod
    def alert(error):
        return f'<div class="alert" role="alert">{html.escape(error)}</div>' if error else ""

    def lock_error(self, error, code):
        wait = locked_for(self.ip)
        if wait:
            return self.t["locked"].format(m=max(1, (wait + 59) // 60)), 429
        return error, code

    def login_page(self, code=200, error="", nxt="/"):
        t = self.t
        error, code = self.lock_error(error, code)
        if code_mode():
            if not read_users():
                error = t["nologin"]
            return self.page(code, t["title"], self.heading(t["title"], t["code_sub"]) + self.alert(error)
                             + f'<form method="post" action="/.gate/login"><input type="hidden" name="next" value="{html.escape(nxt)}">'
                             f'<label>{t["email"]}<input type="email" name="email" autocomplete="email" autocapitalize="none" spellcheck="false" required autofocus></label>'
                             f'<button type="submit">{t["send"]}</button></form>')
        if not read_login():
            error = t["nologin"]
        self.page(code, t["title"], self.heading(t["title"], t["sub"].format(host=self.host)) + self.alert(error)
                  + f'<form method="post" action="/.gate/login"><input type="hidden" name="next" value="{html.escape(nxt)}">'
                  f'<label>{t["email"]}<input type="email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></label>'
                  f'<label>{t["password"]}<input type="password" name="password" autocomplete="current-password" required></label>'
                  f'<button type="submit">{t["submit"]}</button></form>')

    def code_page(self, email, nxt, code=200, error=""):
        t = self.t
        error, code = self.lock_error(error, code)
        back = "/.gate/login?next=" + urllib.parse.quote(nxt, safe="")
        self.page(code, t["code_title"], self.heading(t["code_title"], t["code_sent"].format(email=email, host=self.host, m=CODE_SECONDS // 60)) + self.alert(error)
                  + f'<form method="post" action="/.gate/code"><input type="hidden" name="next" value="{html.escape(nxt)}">'
                  f'<input type="hidden" name="email" value="{html.escape(email)}">'
                  f'<label>{t["code"]}<input class="code" name="code" inputmode="numeric" pattern="[0-9]{{6}}" maxlength="6" autocomplete="one-time-code" required autofocus></label>'
                  f'<button type="submit">{t["submit"]}</button></form>'
                  f'<a class="link" href="{html.escape(back)}">{html.escape(t["other"])}</a>')

    def denied_page(self, email):
        t = self.t
        self.page(403, t["denied_title"], self.heading(t["denied_title"], t["denied_sub"].format(email=email, host=self.host))
                  + f'<a class="btn ghost" href="/.gate/logout">{html.escape(t["logout"])}</a>')

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

    def signed_in(self, email, role, nxt):
        """A new session: admins on a network that can be saved are offered to save it first."""
        clear_failures(self.ip)
        self.log(f"sign-in ok {email}")
        token = make_session(email)
        if role == "admin" and not ip_saved(self.ip):
            can_save, isp, _ = network_check(self.ip)
            if can_save:
                return self.save_page(token, nxt, isp)
        return self.send(302, headers={"Location": nxt, "Set-Cookie": self.cookie(token)})

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
            need_admin = urllib.parse.parse_qs(url.query).get("need") == ["admin"]
            who = self.session()
            if who:
                _, email, role = who
                if need_admin and role != "admin":
                    return self.denied_page(email)
                return self.send(204, headers={"X-Gate-User": email, "X-Gate-Role": role})
            # A saved IP is the owner's own network: it counts as admin, with no email.
            if ip_saved(self.ip):
                return self.send(204, headers={"X-Gate-User": "", "X-Gate-Role": "admin"})
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
        email = (f.get("email") or "").strip().lower()[:200]
        if url.path == "/.gate/login" and code_mode():
            if locked_for(self.ip):
                return self.login_page(nxt=nxt)
            if not EMAIL_RE.match(email):
                return self.login_page(400, self.t["bad_email"], nxt)
            # Same answer, same time, whether the email has access or not: the page never tells who does.
            if email in read_users():
                code = new_code(email)
                if code:
                    threading.Thread(target=send_code, args=(email, code, self.host, self.t), daemon=True).start()
                    self.log(f"code asked {email}")
            return self.code_page(email, nxt)
        if url.path == "/.gate/code" and code_mode():
            if locked_for(self.ip):
                return self.code_page(email, nxt)
            code = re.sub(r"\D", "", f.get("code") or "")[:6]
            role = read_users().get(email)
            if not (role and len(code) == 6 and check_code(email, code)):
                record_failure(self.ip)
                self.log(f"wrong code {email}")
                time.sleep(1)
                return self.code_page(email, nxt, 401, self.t["bad_code"])
            return self.signed_in(email, role, nxt)
        if url.path == "/.gate/login":
            if locked_for(self.ip):
                return self.login_page(nxt=nxt)
            login = read_login()
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
            return self.signed_in(email, "admin", nxt)
        if url.path == "/.gate/save":
            who = self.session()
            if not who or who[2] != "admin" or not hmac.compare_digest(f.get("csrf", ""), csrf_for(who[0])):
                return self.send(302, headers={"Location": "/.gate/login?next=" + urllib.parse.quote(nxt, safe="")})
            if f.get("action") != "save":
                return self.send(302, headers={"Location": nxt})
            can_save, isp, why = network_check(self.ip)
            if not can_save:
                return self.refused_page(nxt, isp, why)
            if f.get("private") != "yes":
                return self.save_page(who[0], nxt, isp, self.t["need_confirm"])
            if not ip_saved(self.ip):
                with state_lock, open(path("ips"), "a") as out:
                    out.write(f"{network_of(self.ip)} # saved from the sign-in page {time.strftime('%Y-%m-%d')} by {who[1]} {isp}\n")
            self.log("ip saved")
            return self.send(302, headers={"Location": nxt})
        return self.send(404)


def cli(args):
    """One email from the command line (expose mail / expose user add --invite). Exit 2 bad usage, 5 Lumail refused."""
    t = TEXT[os.environ.get("GATE_LANG", "fr") if os.environ.get("GATE_LANG") in TEXT else "fr"]
    try:
        if args[:1] == ["test-mail"] and len(args) == 3:
            key = sys.stdin.readline().strip()
            send_email(key, args[1], args[2], t["test_subject"], t["test_body"].format(email=args[2]))
        elif args[:1] == ["invite"] and len(args) >= 3:
            lumail = read_lumail()
            if not lumail:
                print("sign-in codes are off: run 'expose mail' first", file=sys.stderr)
                return 3
            host = urllib.parse.urlsplit(args[2]).hostname or args[2]
            sites = "\n".join(f"- [{u}]({u})" for u in args[2:])
            send_email(lumail[0], lumail[1], args[1], t["invite_subject"].format(host=host), t["invite_body"].format(sites=sites, email=args[1]))
        else:
            print("usage: gate.py test-mail <from> <to> (key on stdin) | gate.py invite <to> <url>...", file=sys.stderr)
            return 2
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 5
    print(f"sent to {args[-1] if args[0] == 'test-mail' else args[1]}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(cli(sys.argv[1:]))
    state = load_state()
    if not os.path.exists(path("secret")):
        with open(path("secret"), "wb") as out:
            out.write(secrets.token_bytes(32))
        os.chmod(path("secret"), 0o600)
    ThreadingHTTPServer(("127.0.0.1", PORT), Gate).serve_forever()
