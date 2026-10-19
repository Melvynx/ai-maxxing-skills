---
name: create-internal-app
description: Create a private internal app on the user's VPS through Dokploy, locked by password and IP allowlist, then hand it to their agent (Hermes). Use when the user wants an internal tool, CRM, dashboard, back-office or an app "just for me" or "only for my team".
argument-hint: "<what the tool does, subdomain>"
disable-model-invocation: true
user-invocable: true
---

Build a private tool on the user's own VPS and hand it to their agent to run. Do every step yourself with the CLIs and only ask for what needs a human (a browser login, their IP). Talk to the user in their language, short messages, no jargon. For an app other people sign up to or pay for, switch to `create-software`.

The app has a normal URL (`crm.my-domain.com`) that nobody else can open, behind three walls: a Cloudflare WAF custom rule on the app and Convex hostnames that lets through only the user's IPs and the VPS IP, Dokploy basic auth with a long random password the user keeps in their password manager, and a server-side secret or signed-in user check in every Convex function. When the user's IP changes (travel, 4G), they ask their agent "add my IP" and it updates the rule. For a team, Cloudflare Access with email codes can replace the IP list.

Keep this stack:

- App: TanStack Start (React, TypeScript, Vite) with a Node server build.
- UI: shadcn/ui on Base UI + Tailwind CSS v4, `lucide-react`, `sonner`.
- Database, backend, crons: Convex, self-hosted on the VPS with the Dokploy Convex template.
- Client jobs: the TanStack libraries listed in `create-software` (Query + `@convex-dev/react-query`, Table, Virtual, Form, Markdown, Hotkeys, Pacer, AI).
- Emails, only if the tool sends some: Lumail through `@lumail/convex`.
- Hosting: Dokploy on the VPS, built from the GitHub repo.
- Domain, DNS, lock: Cloudflare with the `cf` CLI, DNS proxied, WAF IP rule.
- Run and repair: the user's agent (Hermes) with a Dokploy API token.

1. Check access. Dokploy must already be installed on the VPS; if it is not, stop and say so, that is the server setup lesson.

   ```bash
   git --version && gh auth status        # GitHub
   cf --version && cf auth whoami         # Cloudflare
   ssh <vps> 'docker ps --format "{{.Names}}" | head'   # the VPS answers
   dokploy-cli auth test                  # or: the Dokploy API token works (curl the API with it)
   ```

2. Run the `grill-me` skill and build only once the brief is confirmed. For an internal tool, the money question becomes "who besides you uses it", and the address question becomes the subdomain plus the IPs to allow (get the current one with `curl -s https://ifconfig.me` on the user's machine).
3. Scaffold TanStack Start + Tailwind + `npx shadcn@latest init` (Base UI flavor), a Node server build (TanStack Start hosting docs, Nitro preset for Node) and a `Dockerfile` that builds and runs it on port 3000. `git init`, then `gh repo create <name> --private --source . --push`.
4. Deploy the Dokploy Convex template once per VPS (backend + dashboard) on `convex-api.<domain>` and `convex-site.<domain>`, generate the admin key in the backend container, and point the CLI at it with `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` in `.env.local`. Index every query and bound growing tables with `.take(n)` or `.paginate()`. See the `convex` skill.
5. Write one helper every public Convex function calls first (a shared secret set with `npx convex env set`, or Better Auth with email OTP if several people use it). Anything only the server calls is `internal*`.
6. Build the screens with `useSuspenseQuery(convexQuery(...))` so data updates live, lists in TanStack Table, forms in TanStack Form, and `cmd+k` plus `j`/`k` with TanStack Hotkeys, since an internal tool is used all day.
7. Make it fast on every page with [references/fast-app.md](references/fast-app.md): `defaultPreload: "intent"`, a 30 s query cache, a loader on detail pages, a custom `pendingComponent` skeleton on every route that matches the real layout, a loading state on every async button, indexed and bounded Convex reads. An app without these is not done.
8. Create the Dokploy application from the GitHub repo (Dockerfile build) with the env vars (Convex URL, secrets) set in Dokploy, never in the repo, and auto deploy on push.
9. Attach `tool.<domain>` in Dokploy with HTTPS, then create the DNS record in Cloudflare yourself (A record to the VPS IP, proxied). Never open a port on the VPS for the app: everything goes through Dokploy's proxy behind Cloudflare.
10. Enable basic auth on the Dokploy application with a generated password. Give it to the user once and tell them to save it in their password manager; never write it in a file.
11. Create the Cloudflare WAF custom rule that blocks the app and Convex hostnames for any IP outside the list (user IPs + the VPS IP). Find the command with `cf cli search "waf custom rule"`.
12. Add the Convex volume to the nightly Dokploy backup to R2 if the VPS has one.
13. Hand it to the agent: write an `About.md` in the agent's project folder with the URL, the repo, the Dokploy application id, the Convex URLs, where the password lives (never the password) and the IP rule id. Tell the agent how to redeploy (push, or the Dokploy API) and read deploy logs, read app logs and fix when the user says "it's broken", and add or remove an IP in the rule.
14. Prove it: from an allowed IP the URL asks for the password, then the app loads and the main action works with real data; from a non-allowed IP (another server, or a different network) Cloudflare blocks both the app and the Convex API hostname; a push to GitHub redeploys on its own. Fix every error you see, then run `audit-safety` on the Convex functions and the lock.

Never print, commit or log the password, the admin key or tokens. Reply with the URL, how to open it (password + allowed IPs), and what the agent can now do on it.
