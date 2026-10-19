---
name: create-software
description: Create a new web app hosted on Cloudflare with the AI Maxxing stack - TanStack Start, shadcn/ui on Base UI, Convex for all data and backend, TanStack libraries for every client job (data fetching, lists and tables, forms, markdown, keyboard shortcuts), Better Auth for sign-in and Lumail for marketing emails. Use when the user wants to create, scaffold, deploy or finish a public app or personal SaaS that other people use or pay for (course platform, membership, client portal), replace a paid SaaS with their own app, or says "fais-le toi-même". For a private tool only the user and their agent use, use `create-internal-app` instead.
argument-hint: "<what the app does, domain or subdomain>"
disable-model-invocation: true
user-invocable: true
---

Build a working web app on the user's own accounts and put it live on their Cloudflare domain. Do every step yourself with the CLIs; only ask for what needs a human (a browser login, a device code, a payment, a secret key). Talk to the user in their language, short messages, no jargon.

## Stack (do not swap a layer unless the user asks)

| layer | tool |
| --- | --- |
| app, routing, server functions | TanStack Start (React, TypeScript, Vite) |
| UI | shadcn/ui on Base UI + Tailwind CSS v4, `lucide-react` icons, `sonner` toasts |
| database, backend, files, crons | Convex, for everything: no other database, no other API server |
| auth | Better Auth through `@convex-dev/better-auth`, email OTP by default |
| marketing and login emails | Lumail through `@lumail/convex` |
| payments (only if the app sells) | Stripe Checkout, see the `stripe-checkout` skill |
| video | Tella embeds (the user pastes the Tella URL) |
| hosting, domain, DNS | Cloudflare Workers with the `@cloudflare/vite-plugin`, deployed with `cf` |
| code | Git + one private GitHub repo |

### TanStack for every client job

Reach for the TanStack library before any other package:

| job | package |
| --- | --- |
| fetching, cache, loading states | `@tanstack/react-query` + `@convex-dev/react-query` (`convexQuery(api.x.y, args)`) |
| lists, tables, sorting, filters, pagination | `@tanstack/react-table` |
| long lists (hundreds of rows) | `@tanstack/react-virtual` |
| forms and validation | `@tanstack/react-form` + `zod` |
| render markdown | `@tanstack/markdown` |
| keyboard shortcuts (`cmd+k`, `j`/`k`, `esc`) | `@tanstack/react-hotkeys` |
| debounce search, throttle saves | `@tanstack/react-pacer` |
| AI chat or generation in the app | `@tanstack/ai-react` |

Check the current API of each package with the docs before using it (`npm view <pkg> version`, then its README or the `find-docs` skill). Never guess an API from memory.

## 1. Check access before writing code

```bash
git --version && gh auth status       # GitHub
cf --version && cf auth whoami        # Cloudflare (npm i -g cf, then cf auth login)
npx convex --version                  # Convex (npx convex login when building)
npx lumail@latest auth test           # Lumail (npx lumail@latest setup --authenticate)
```

Fix what fails first. When a login needs the browser, give the exact link or code and wait for "done". Secrets go only in `.env.local`, `npx convex env set` or Cloudflare secrets, never in a committed file.

## 2. Grill, then build

Always run the `grill-me` skill before writing any code, even when the brief looks clear: it asks the user about the app they want (who it is for, the main action, the data, who sees what, money, emails, domain, look, v1 scope, what "done" means), with a recommended answer for each question. Build only once the user has confirmed the final brief. Skip it only if the user already confirmed a brief in this conversation. Defaults: landing at `/`, app at `/app`, English UI, OTP sign-in, the user is the only admin.

1. **Scaffold**: TanStack Start + Tailwind + `npx shadcn@latest init` (Base UI flavor), add the components you need with `npx shadcn@latest add`. `git init`, `gh repo create <name> --private --source . --push`.
2. **Convex**: `npx convex dev --once` creates the project and writes `.env.local`. One `schema.ts` with an index for every query. Every public function checks the signed-in user and ownership server-side; anything only the server calls is `internal*`. Bound reads with `.take(n)` or `.paginate()`. See the `convex` skill.
3. **Better Auth**: register both components in `convex/convex.config.ts` (`app.use(betterAuth)`, `app.use(lumail)`), `createAuth` with `authComponent.adapter(ctx)`, the `emailOTP` plugin and the `convex({ authConfig })` plugin, routes via `authComponent.registerRoutes(http, createAuth)`. `BETTER_AUTH_SECRET` and `SITE_URL` as Convex env vars. Protect `/app` in the route `beforeLoad`, and again in every Convex function.
4. **Lumail**: see the next section.
5. **Data on screen**: queries through `useSuspenseQuery(convexQuery(...))` so the UI updates live, lists in TanStack Table, forms in TanStack Form calling Convex mutations, toasts on success and error.
6. **Payments** (only if the app sells): start with a fake checkout until the user gives Stripe test keys, then real Checkout + a signed webhook in `convex/http.ts` that grants access. Test card `4242 4242 4242 4242`, live keys only once the test flow works. See the `stripe-checkout` skill.
7. Clean error page and 404 page, a favicon, page titles.

## 3. Lumail, with skip double opt-in by default

One `convex/email.ts` holds every Lumail call; the API key (`LUMAIL_API_KEY`, created by you with `lumail tokens --help`) never reaches the browser.

- **Login codes**: `sendVerificationOTP` schedules an internal mutation that calls `lumail.sendEmail(ctx, { ..., transactional: true })`. Without a key, log the code to the Convex console so local dev still works.
- **Signups**: in Better Auth `databaseHooks.user.create.after`, upsert the person with `lumail.upsertSubscriber(ctx, { email, tags: ["<app-slug>-user"], triggerWorkflows: true })`.
- **Skip double opt-in = true as the general rule** for anyone who signs in or buys: the OTP or the payment already proves they own the email, so they go straight to "subscribed" and tag workflows fire right away. The component cannot pass that flag, so also call the API from an internal action:

```ts
await fetch("https://lumail.io/api/v1/subscribers", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.LUMAIL_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, skipDoubleOptIn: true }),
});
```

- Keep double opt-in only for a cold form (newsletter or waitlist where the email is not verified).
- Sending domain: create it with `lumail domain --help`, then add the DNS records it returns in Cloudflare yourself (unproxied). More in the `lumail` skill.

## 4. Deploy on Cloudflare

1. `wrangler.jsonc`: `main: "@tanstack/react-start/server-entry"`, `compatibility_flags: ["nodejs_compat"]`, `SITE_URL` in `vars`, the custom domain in `routes` with `custom_domain: true`.
2. `npx convex deploy` for the production backend, set prod env vars with `npx convex env set --prod`, and put `VITE_CONVEX_URL` / `VITE_CONVEX_SITE_URL` of prod in the build env.
3. Build and deploy with `cf` (`cf build`, `cf deploy`, or `cf cli search "deploy worker"`), never by hand in the dashboard. See the `cloudflare` skill.
4. The domain must be in the user's Cloudflare account. If it is elsewhere, tell them to move the name servers or buy it in Cloudflare.

## 5. Prove it works

Open the live URL and walk the real flows: landing, sign in with a real OTP email, the main action of the app, a list with real rows, a test purchase if the app sells, a keyboard shortcut, sign out, the 404 page. Check the person shows up in Lumail as subscribed with the right tag. Fix every error you see, then run `audit-safety` on auth, data access and payments before saying it is live.

## Rules

- "Fais-le toi-même": use every CLI and API before asking the user to click something.
- Never print, commit or log secrets.
- Reply with what is live, the URL, and what is left to do.
