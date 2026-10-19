---
name: create-internal-app
description: Create a private internal app (CRM, dashboard, admin tool, tracker) that runs on the user's VPS through Dokploy and is managed by their agent (Hermes). It has a public URL locked like the Hermes HQ - a password, then an IP allowlist - so only the user and their agent can open it. Same stack as create-software (TanStack Start, shadcn/ui on Base UI, self-hosted Convex, TanStack libraries). Use when the user wants an internal tool, a back-office, a personal dashboard, or an app "just for me" or "only for my team".
argument-hint: "<what the tool does, subdomain>"
disable-model-invocation: true
user-invocable: true
---

Build a private tool on the user's own VPS and hand it to their agent to run. Do every step yourself with the CLIs; only ask for what needs a human (a browser login, a password to choose, their IP). Talk to the user in their language, short messages, no jargon. For an app other people sign up to or pay for, use `create-software` instead.

## How it is locked

The app has a normal URL (`crm.my-domain.com`) but nobody else can open it:

1. **IP allowlist** in Cloudflare (WAF custom rule on the app and Convex hostnames): only the user's IPs and the VPS IP get through, everyone else is blocked before reaching the server.
2. **Password** on the app (Dokploy basic auth on the application, a long random password the user saves in their password manager).
3. Every Convex function still checks a server-side secret or the signed-in user: the lock is the outer wall, not the only one.

When the user's IP changes (travel, phone on 4G), they ask their agent "add my IP" and it updates the Cloudflare rule. Optional upgrade for a team: Cloudflare Access with email codes instead of the IP list.

## Stack

| layer | tool |
| --- | --- |
| app | TanStack Start (React, TypeScript, Vite), Node server build |
| UI | shadcn/ui on Base UI + Tailwind CSS v4, `lucide-react`, `sonner` |
| database, backend, crons | Convex, self-hosted on the VPS (Dokploy Convex template) |
| client jobs | the TanStack libraries listed in `create-software` (Query + `@convex-dev/react-query`, Table, Virtual, Form, Markdown, Hotkeys, Pacer, AI) |
| emails (only if the tool sends some) | Lumail through `@lumail/convex` |
| hosting | Dokploy on the user's VPS, built from the GitHub repo |
| domain, DNS, lock | Cloudflare (`cf` CLI): DNS proxied, WAF IP rule |
| run and repair | the user's agent (Hermes) with a Dokploy API token |

## 1. Check access

```bash
git --version && gh auth status        # GitHub
cf --version && cf auth whoami         # Cloudflare
ssh <vps> 'docker ps --format "{{.Names}}" | head'   # the VPS answers
dokploy-cli auth test                  # or: the Dokploy API token works (curl the API with it)
```

Dokploy must already be installed on the VPS. If it is not, stop and say so: that is the server setup lesson, not this skill.

## 2. Grill, then build

Always run the `grill-me` skill first. For an internal tool, the money question becomes "who besides you uses it", and the address question becomes the subdomain plus the IPs to allow (get the user's current IP with `curl -s https://ifconfig.me` on their machine). Build only once the brief is confirmed.

1. **Scaffold**: TanStack Start + Tailwind + `npx shadcn@latest init` (Base UI flavor). Add a Node server build (TanStack Start hosting docs, Nitro preset for Node) and a `Dockerfile` that builds and runs it on port 3000. `git init`, `gh repo create <name> --private --source . --push`.
2. **Convex self-hosted**: deploy the Dokploy Convex template once per VPS (backend + dashboard), give it `convex-api.<domain>` and `convex-site.<domain>`, generate the admin key in the backend container, then point the CLI at it with `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` in `.env.local`. Schema with an index per query, `.take(n)` or `.paginate()` on growing tables. See the `convex` skill.
3. **Server-side check**: one helper every public Convex function calls first (a shared secret set with `npx convex env set`, or Better Auth with email OTP if several people use it). Anything only the server calls is `internal*`.
4. **Screens**: data through `useSuspenseQuery(convexQuery(...))` so it updates live, lists in TanStack Table, forms in TanStack Form, `cmd+k` and `j`/`k` with TanStack Hotkeys (internal tools are used all day, shortcuts matter).

## 3. Deploy and lock

1. Dokploy: create the application from the GitHub repo (Dockerfile build), set the env vars (Convex URL, secrets) in Dokploy, never in the repo. Turn on auto deploy on push.
2. Domain: attach `tool.<domain>` in Dokploy with HTTPS, then create the DNS record in Cloudflare yourself (A record to the VPS IP, proxied).
3. Password: enable basic auth on the Dokploy application with a generated password. Give it to the user once, tell them to save it in their password manager, never write it in a file.
4. IP allowlist: create a Cloudflare WAF custom rule on the zone that blocks requests to the app and Convex hostnames when the IP is not in the list (user IPs + the VPS IP). Find the command with `cf cli search "waf custom rule"`.
5. Backups: add the Convex volume to the nightly Dokploy backup to R2 if the VPS has one.

## 4. Hand it to the agent

Write the tool in the agent's workspace so it can run it alone: an `About.md` in the project folder with the URL, the repo, the Dokploy application id, the Convex URLs, where the password lives (never the password itself), and the IP rule id. Then tell the agent how to:

- redeploy (push to GitHub, or the Dokploy API) and read the deploy logs;
- read the app logs when the user says "it's broken", fix, push, check;
- add or remove an IP in the Cloudflare rule when the user asks.

## 5. Prove it works

- From an allowed IP: the URL asks for the password, then the app loads and the main action works with real data.
- From a non-allowed IP (a request from another server, or `curl` through a different network): Cloudflare blocks it.
- The Convex API hostname is blocked from a non-allowed IP too.
- A push to GitHub redeploys on its own.

Fix every error you see, then run `audit-safety` on the Convex functions and the lock before saying it is live.

## Rules

- "Fais-le toi-même": use every CLI and API before asking the user to click something.
- Never print, commit or log the password, the admin key or tokens.
- Never open a port on the VPS for the app: everything goes through Dokploy's proxy behind Cloudflare.
- Reply with the URL, how to open it (password + allowed IPs), and what the agent can now do on it.
