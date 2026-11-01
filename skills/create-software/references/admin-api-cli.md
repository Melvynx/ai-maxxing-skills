# Admin, API and CLI: full control by AI

Every app ships with three layers on top of the product, built the same way as Lumail (admin pages, `/api/admin/*`, `luma_` admin keys, the `lumail` CLI and its skill):

1. An admin area at `/admin` for the owner.
2. A versioned API at `https://<domain>/api/v1`, reached with an API key.
3. A CLI named after the app, plus a `<app>-cli` skill, so the user's agent (Claude Code, Codex, Hermes) runs the app from any folder.

The rule: anything the owner can see or do in `/admin`, the API can do, and the CLI can do. If a button exists in the admin and no CLI command does the same thing, the app is not done.

## One function, three doors

Write each action once, as an `internal*` Convex function in `convex/admin/<resource>.ts` (`listUsers`, `getUser`, `banUser`, `refundOrder`...). Then call it from:

- the admin UI, through a public query or mutation that runs `requireAdmin(ctx)` first;
- the API, through an HTTP action that checks the API key first;
- never copy the logic into the HTTP action or the page.

Every write through any door also writes one row in an `auditLog` table (who, which key or user, action, target id, time). The admin shows it as an "Activity" page.

## Admin area

- `/admin` is protected in the route `beforeLoad` and again in every Convex function with `requireAdmin(ctx)`. Admins are a `role: "admin"` field on the user, set for the owner's email during setup; nobody else can become admin from the UI.
- Pages, at least: overview (key numbers), users (TanStack Table, search, open one, ban or delete), one page per main data object from `SPEC.md`, payments if the app sells, API keys, activity.
- Same look as the app (shadcn/ui), a sidebar, no separate design.

## API keys

- Table `apiKeys`: `name`, `prefix` (first 12 characters, shown in the list), `hash` (SHA-256 of the full key), `scope` (`"admin"` for the whole app, `"user"` for one user's own data), `userId`, `createdAt`, `lastUsedAt`, `revokedAt`. Index by `hash`.
- Keys look like `<slug>_admin_<32 random chars>` or `<slug>_<32 random chars>`, made with `crypto.getRandomValues`. Store only the hash. Show the full key once at creation, with a copy button, then never again.
- The "API keys" admin page creates, names, lists (prefix, scope, last used) and revokes keys. Admin keys are created only there. Add user keys in the user's settings only if `SPEC.md` says customers get API access.
- One helper, `authenticateKey(ctx, request)`: reads `Authorization: Bearer <key>`, hashes it, finds a non-revoked row, updates `lastUsedAt` at most once a minute, returns `{ scope, userId }` or a 401. A `"user"` key only ever touches rows of its `userId`; every `/api/v1/admin/*` route refuses anything but `"admin"`.

## API

- Routes live in `convex/http.ts` as `httpAction`s under `/api/v1/...`: `/api/v1/admin/<resource>` for the owner, `/api/v1/<resource>` for user keys if the app has them.
- Keep the public URL on the app domain: one TanStack Start server route `src/routes/api/v1/$.ts` forwards the method, headers, query and body to `${VITE_CONVEX_SITE_URL}/api/v1/...` and returns the response as is.
- REST and JSON only: `GET` list (paginated with `cursor` + `limit`, 100 max) and get by id, `POST` create, `PATCH` update, `DELETE` delete. Validate every body with `zod`. Errors are `{ "error": { "code", "message" } }` with the right status (400, 401, 403, 404, 409, 429).
- `GET /api/v1` (no key needed) returns the list of routes with one line each, so the CLI help and the agent always see what exists.
- Rate limit by key with the Convex rate limiter component.

## CLI

- Lives in the repo at `cli/`: one `cli/<app>.mjs` file, Node 20+, no dependency (`fetch`, `node:util` `parseArgs`), and a `cli/package.json` with `"bin": { "<app>": "./<app>.mjs" }`. Install it for the user with `npm install -g ./cli`.
- Commands are `<app> <resource> <action> [args]`, the same names as the API: `<app> users list --search ana`, `<app> users get <id>`, `<app> orders refund <id> --confirm`. Plus `<app> login` (hidden input, saves `URL` and `KEY` in `~/.config/<app>/env`, mode 600), `<app> whoami`, `<app> api <METHOD> <path> [--data '<json>']` as an escape hatch for any route.
- `--help` on every level, `--json` on every command (raw API JSON for agents), readable tables otherwise. Exit code 1 on any error, with the API message.
- Anything that deletes, refunds, sends emails or spends money needs `--confirm`; without it the command prints what it would do and stops.
- Never prints the key. `<APP>_API_KEY` and `<APP>_URL` env vars override the saved file (useful on the server).

## Skill for the agent

Write `~/.agents/skills/<app>-cli/SKILL.md` (link it in `~/.claude/skills` if that folder is not already a link to `~/.agents/skills`), under 40 lines, with only commands you ran:

```markdown
---
name: <app>-cli
description: Run <App> (<domain>) from the terminal: <main resources>. Use when the user asks to <4-6 real admin tasks in their words>.
---

Run `<app> <resource> <action>`; check `--help` before a command you have not used. Pass `--json` to read results. Auth: `<app> login` with an admin key from https://<domain>/admin/api-keys.

- <Task>: `<app> ...`
- ...

Read before writing. `--confirm` only after the user said yes to that exact delete, refund, send or payment. Repo: <github url>, API: https://<domain>/api/v1.
```

If the user has a server agent (Hermes), copy the skill there too and set `<APP>_API_KEY` / `<APP>_URL` in its env.

## Done means

- A new admin key is created from `/admin/api-keys`, saved with `<app> login`.
- `<app> whoami` shows the admin scope, and `<app> <resource> list --json` returns the same rows as the admin page, on the live URL.
- One write through the CLI shows up in the admin and in Activity.
- A request with no key, a revoked key, or a user key on `/api/v1/admin/*` gets 401 or 403.
- A fresh agent session, asked in plain words ("how many users signed up this week?", "ban this user"), uses `/<app>-cli` and gets it right.
