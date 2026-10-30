# Dashboard

The owner's personal dashboard, next to their Hermes agent. It ships with no module on purpose: the owner asks for the modules they want ("show my latest conversations", "a morning report", "my sales of the day") and the agent builds them here. Build only what was asked, one module at a time. One part is built in for admins: **Infra** (see below).

- Stack: TanStack Start (React 19, file routes, server functions), Vite, Tailwind 4, Radix, lucide icons, sonner toasts, zod, SQLite through better-sqlite3 and drizzle. Tests with vitest. Node 24, pnpm.
- Runs on the server as the `dashboard` service on `127.0.0.1:8794`, published at its `url` (see `dashboard status`) behind the server's sign-in gate. Never bind another address, never open a port.
- Data: `$DATA_DIR/dashboard.sqlite3` (`~/.local/share/dashboard` on the server). Settings: `/etc/dashboard.env`.
- Never print a key, a token or the Hermes session token. Never delete the database or `key-pepper`.

## Who is signed in

The gate signs people in by email code and tells the dashboard who is there. Users and roles live on the server (`expose user list`, `expose user add <email> member --invite`).

- `getViewer()` from `@/server/viewer` returns `{ email, role }`. `role` is `"admin"` or `"member"`; `email` is null on a saved IP or for a call from the server itself (both count as admin).
- Admins see everything. Members see every module, but not the Hermes link, Infra or the API keys page.
- A module or action that only admins should have: call `requireAdmin()` at the top of its server function (it throws for a member), and hide its sidebar line or button when `Route.useLoaderData()` or the root loader's `viewer.role` is not `"admin"`. Hiding alone is not enough: always check on the server too.
- A module whose data is per person (my tasks, my notes): store `getViewer().email` with each row and filter on it.

## Infra (built in)

`/infra`, admins only, under the sidebar line "Infra" and a card on the home. Code in `src/server/infra/` and `src/routes/infra.*.tsx`.

- **Health**: the dashboard checks the server every 15 minutes (Hermes chat, crons, Hermes update, key services, disk, memory, load, pending restart, system updates, out-of-memory kills, SSH, firewall, open ports) and keeps 7 days of history. A stopped `caddy`, `vps-gate`, `vps-tunnel` or `hermes-dashboard` is restarted on its own, once an hour at most. Nothing else is ever changed by a check.
- **Daily audit**: a Hermes cron named `infra-audit` (07:00, created once; if the owner deletes it, it stays deleted). It only looks and writes a report; the page reads it from `~/.hermes/cron/output/<job id>/`.
- **Fix**: each problem and each audit action has a "Fix" button. It sends an editable task to the Hermes board (`hermes kanban create`), one open task per problem, and the page follows its status.
- Add a check: a function in `src/server/infra/checks.ts` that returns a `Check` (tone `good`, `warn`, `bad`, or `idle` when it could not check), listed in `runChecks`, with a test in `infra.test.ts`. A check reads through `System` (never `child_process` directly) and never changes the server; anything to change becomes a `fix` draft (`checkFix`).
- Settings in `/etc/dashboard.env`: `INFRA_CHECKS=off` stops the timed checks, `INFRA_AUDIT=off` stops creating the audit cron, `HERMES_BIN` and `HERMES_HOME` when Hermes is not in `~/.local/bin/hermes` and `~/.hermes`.
- `dashboard-cli get /api/v1/infra`: the last check, the last audit and the open fixes, as JSON.

## Add a module

A module is a page, its line in the sidebar and its mark. The home shows a card for every module on its own.

1. **Mark.** In `src/components/brand.tsx`, add the module key to `Section` (kebab-case, e.g. `"sales"`), a drawing in `DRAWINGS` (white shapes on the indigo tile, `viewBox 0 0 32 32`, same style as `hermes`) and its name in `SECTION_NAMES`.
2. **Sidebar.** In `src/components/hub/sidebar.tsx`, add the path to `Item["to"]` and a line to `ITEMS`: `{ to: "/sales", label: "Sales", hint: "Today's orders", section: "sales" }`. The order of `ITEMS` is the order of the sidebar and of the home.
3. **Data.** In `src/server/functions.ts`, add a `createServerFn({ method: "GET" })` that returns exactly what the page shows. Validate any input with `.validator(z.object(...))`. Wrap reads that can fail (Hermes stopped, an outside API down) in `orNull(...)` so the page shows `<Unavailable what="..." />` instead of breaking.
   - From Hermes: `getApp().hermes.api<T>(path)` (the session token is handled for you). Useful paths: `/api/status`, `/api/model/info`, `/api/sessions?limit=20&order=recent`, `/api/cron/jobs`, `/api/skills`, `/api/analytics/usage?days=7`. Look at a real answer first with `dashboard hermes <path>`. Times may be seconds or ISO strings: convert with `toMs` from `@/server/hermes`.
   - Its own data: add the table to `BOOTSTRAP` in `src/server/db/client.ts` (`CREATE TABLE IF NOT EXISTS`, never drop or rewrite a table) and the same table to `src/server/db/schema.ts`, then read and write it with drizzle on `getApp().db`.
4. **Page.** Add `src/routes/<path>.tsx` with `createFileRoute("/<path>")({ loader: () => getX(), head: () => ({ meta: [{ title: "Sales · Hermes" }] }), component })`. Wrap it in `<Page section="sales" hint="...">` from `@/components/hub/page` and reuse what is there: `Table`, `Empty`, `Unavailable`, `Dot`, the `Button`, `Input`, `Badge` and `Sheet` of `src/components/ui`, `ago` / `until` / `count` / `dateTime` of `@/lib/format`. Colours only through the tokens of `src/styles.css` (`text-muted-foreground`, `bg-card`, `text-good`, `text-warn`, `text-bad`, `text-brand`), so the dark theme keeps working. It must read well at phone width.
5. **Agent API (only when something must push data in).** When a cron or the agent writes to the module, add `src/routes/api/v1/<name>.ts` with `withKey("dashboard:write", handler)` from `@/server/api`, read the body with `readJson` and validate it with zod. The agent calls it with `dashboard-cli post /api/v1/<name> '<json>'`; reads use `dashboard:read`.
6. **Test.** Add a test next to the code you wrote: a server test (`src/server/**/*.test.ts`) for new data code, a UI test (`*.test.tsx`) when the page has logic. The home test passes its own `items`, so a new module never needs to change it.
7. **Ship.** `dashboard deploy`. It installs, typechecks, tests and builds before it restarts the service, and stops at the first error with the old version still online. Then `git add -A && git commit -m "<module>: <what it shows>" && git push`.

Tell the owner the module is online at `<url>/<path>` and what it shows, in one or two lines.

## Change or remove a module

Change it in place. To remove one, delete its route and its lines in `ITEMS`, `Section`, `DRAWINGS` and `SECTION_NAMES`; keep its table (the data stays). Infra is not a module: keep it. Then `dashboard deploy`, commit and push.

## Commands

- `dashboard deploy`: install, typecheck, test, build, restart, health check.
- `dashboard status`: service state, health, public `url`, local address.
- `dashboard logs`: the last lines of the service log.
- `dashboard hermes <path>`: a Hermes API answer as JSON.
- `dashboard key`: a new key for `dashboard-cli`, saved in `~/.config/dashboard/env` (the old one stops working).
- `dashboard-cli get|post|delete <path> [json]`: call the dashboard API with that key. `dashboard-cli get /api/v1/whoami` checks the key.
- Local work: `pnpm dev` (port 3000), `pnpm typecheck`, `pnpm test`.
