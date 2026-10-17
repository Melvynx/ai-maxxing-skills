---
name: personal-saas
description: Build and ship a personal SaaS end to end (course platform, membership, tool, internal app) on TanStack Start, shadcn/ui, Convex, Better Auth (email OTP), Lumail, Stripe Checkout, deployed on Cloudflare with the user's domain. Use when the user wants to create, set up, deploy or finish their own SaaS, replace a paid SaaS with their own app, or says "fais-le toi-même".
argument-hint: "<what the app does, domain>"
disable-model-invocation: true
user-invocable: true
---

Ship a working personal SaaS on the user's own accounts. The user should not lift a finger: do every step yourself with the CLIs and connectors, and only ask for what truly needs a human (a login in the browser, a device code, a payment, a secret key).

## Default stack

| layer | tool |
| --- | --- |
| app | TanStack Start + React + TypeScript |
| UI | shadcn/ui on Base UI + Tailwind CSS |
| database, backend | Convex |
| auth | Better Auth, email OTP only (no passwords) |
| email | Lumail (OTP codes, marketing, workflows) |
| payments | Stripe Checkout |
| hosting, DNS, domain | Cloudflare (official `cf` CLI, never Wrangler) |
| video | Tella embeds (the user pastes the Tella URL) |
| code | Git + GitHub, one private repo |

Change a layer only when the user asks or the project already uses something else.

## 1. Check access before writing code

Run each check and fix what fails before building:

```bash
git --version && gh auth status          # GitHub
cf --version && cf auth whoami           # Cloudflare (npm i -g cf, then cf auth login)
npx convex --version                     # Convex (npx convex login when building)
npx lumail@latest auth test              # Lumail (npx lumail@latest setup --authenticate)
```

When a login needs the browser, give the user the exact link or code and wait for "done". Never ask the user to paste secrets in a file; read them from the conversation and store them only in the right env (`.env.local`, `npx convex env set`, Cloudflare secrets).

## 2. Grill before building

If the brief is vague, run the `grill-me` skill first: paid access, one or many products, roles, admin bootstrap, content model, language, design direction. Defaults when the user does not care: Stripe Checkout, admin set manually by you, progress tracking on, English UI unless told otherwise.

## 3. Build

1. Scaffold TanStack Start + Tailwind + shadcn/ui, init git, create the private GitHub repo and push.
2. Create the Convex project and deployments (`npx convex dev --once`), schema with indexes for every query, `npx convex env set` for server secrets.
3. Better Auth with the Convex adapter and the email OTP plugin; OTP emails are sent through the Lumail transactional email API (create the Lumail API key yourself with the Lumail CLI or MCP).
4. Landing page at `/`, app at `/app`, admin editor behind a server-checked admin role. Every Convex function checks auth and ownership server-side.
5. Stripe: start with a fake checkout until the user gives test keys, then real Checkout + a signed webhook that grants access (see the `stripe-checkout` skill).
6. On signup or purchase, upsert the person in Lumail as subscribed (skip double opt-in for buyers) with a tag per product.

## 4. Deploy on Cloudflare

1. Build the Worker and deploy with `cf` (never Wrangler). Use `cf cli search "<job>"` to find commands.
2. Attach the custom domain or subdomain and create the DNS records yourself (`cf dns records ...`). The domain must live in the user's Cloudflare account; if it is elsewhere, tell the user to buy it in Cloudflare or switch the name servers.
3. Lumail sending domain and web domain: create them, then add the DNS records Lumail returns in Cloudflare yourself.
4. Set production env vars and Convex production deploy (`npx convex deploy`).

## 5. Prove it works

Open the live URL and walk the real flows: landing, signup with an email OTP, buy with Stripe test card `4242 4242 4242 4242`, access unlocked, admin edits a lesson, error pages look clean. Fix every error you see, then run the `audit-safety` skill on auth, payments, member area and admin before announcing it is live.

## Rules

- "Fais-le toi-même": exhaust every CLI, connector and API before asking the user to do something by hand.
- Never print, commit or log secrets. Test keys first, live keys only when the user says the test flow works.
- Keep the user informed in short messages: what is live, the URL, what is left.
