---
name: create-landing
description: Create a landing page, sales page or waitlist hosted on Cloudflare - TanStack Start, shadcn/ui on Base UI, Tailwind CSS v4, a Lumail email form and an optional buy button (Stripe Checkout or Codeline link). No database, no sign-in. Use when the user wants a landing page, a sales page, a waitlist, a launch page, a lead magnet page or a one-page site for a product, a course or an event. For an app people sign in to, use `create-software`; for a private tool, use `create-internal-app`.
argument-hint: "<what the page sells or collects, domain or subdomain>"
disable-model-invocation: true
user-invocable: true
---

Build one fast page that turns visitors into emails or buyers, and put it live on the user's Cloudflare domain. Do every step yourself with the CLIs; only ask for what needs a human (a browser login, a payment link, a photo). Talk to the user in their language, short messages, no jargon. If the page needs accounts, a dashboard or saved data, stop and use `create-software` instead.

## Stack (do not swap a layer unless the user asks)

| layer | tool |
| --- | --- |
| page, routing, server function for the form | TanStack Start (React, TypeScript, Vite), pages prerendered |
| UI | shadcn/ui on Base UI + Tailwind CSS v4, `lucide-react` icons, `sonner` toasts |
| email form | TanStack Form + `zod`, a server function that calls the Lumail API |
| buy button (only if it sells) | a Stripe Checkout payment link or the user's Codeline checkout URL |
| video (optional) | Tella embed (the user pastes the Tella URL) |
| hosting, domain, DNS | Cloudflare Workers with the `@cloudflare/vite-plugin`, deployed with `cf` |
| code | Git + one private GitHub repo |

No Convex, no Better Auth, no database: a landing only shows content and sends emails to Lumail.

## 1. Check access

```bash
git --version && gh auth status       # GitHub
cf --version && cf auth whoami        # Cloudflare (npm i -g cf, then cf auth login)
npx lumail@latest auth test           # Lumail (npx lumail@latest setup --authenticate)
```

Fix what fails first. When a login needs the browser, give the exact link or code and wait for "done".

## 2. Grill, then write

Always run the `grill-me` skill first, in its landing mode: who the page is for, the problem, the promise in one sentence, the offer and price, the proof (testimonials, numbers, screenshots), objections, the one call to action, the Lumail tag, the domain, the look. Build only once the user has confirmed the brief.

Write the copy before the code, in the user's language and voice, and show it as plain text for a yes. Sections, in this order unless the brief says otherwise: hero (promise, sub-promise, call to action), the problem, the solution, what they get, proof, offer and price, FAQ for the objections, final call to action, footer with legal links. Never invent a testimonial, a number or a deadline: use only what the user gave, or leave a clear placeholder.

## 3. Build

1. **Scaffold**: TanStack Start + Tailwind + `npx shadcn@latest init` (Base UI flavor), add only the components you need. `git init`, `gh repo create <name> --private --source . --push`.
2. **Page**: one route `/` built from the sections, plus `/merci` (thank-you page after signup or purchase) and `/mentions-legales` or `/legal`. Prerender every page. Real `<title>`, meta description, Open Graph image (1200x630), favicon.
3. **Look**: follow the 1 or 2 sites the user likes: one font pair, one accent color, generous spacing, mobile first. Images in WebP with width and height set, no layout shift, no heavy animation library.
4. **Email form**: TanStack Form + `zod` on the client, then a `createServerFn` that posts to Lumail. The API key stays on the server (`LUMAIL_API_KEY` as a Cloudflare secret, created by you with `lumail tokens --help`):

```ts
await fetch("https://lumail.io/api/v1/subscribers", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.LUMAIL_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, tags: ["<page-slug>-lead"] }),
});
```

   Keep double opt-in on: a landing form is cold, the email is not verified. Add a hidden honeypot field and reject empty or fake emails on the server. After a success, go to `/merci`. Create the tag workflow in Lumail (welcome email, lead magnet) with the `lumail` skill if the brief asks for one.
5. **Buy button** (only if it sells): link to the Stripe payment link or the Codeline checkout, with the success URL set to `/merci`. Never collect card details on the page.
6. **Tracking** (only if the user asks): one privacy-friendly analytics script, nothing that needs a cookie banner.

## 4. Deploy on Cloudflare

1. `wrangler.jsonc`: `main: "@tanstack/react-start/server-entry"`, `compatibility_flags: ["nodejs_compat"]`, the custom domain in `routes` with `custom_domain: true`.
2. Set `LUMAIL_API_KEY` as a Cloudflare secret, never in a committed file.
3. Build and deploy with `cf` (`cf build`, `cf deploy`, or `cf cli search "deploy worker"`), never by hand in the dashboard. See the `cloudflare` skill.
4. The domain must be in the user's Cloudflare account. If it is elsewhere, tell them to move the name servers or buy it in Cloudflare.

## 5. Prove it works

- Open the live URL on desktop and at phone width: every section shows, no horizontal scroll, every link and button works.
- Sign up with a real email: the page goes to `/merci`, the person shows up in Lumail with the right tag, the confirmation email arrives.
- The buy button opens the right checkout with the right price.
- Lighthouse on mobile: performance and accessibility at 90 or more. Fix what pulls the score down.
- Share the URL in a chat preview: the title, description and image show.

Fix every error you see before saying it is live.

## Rules

- "Fais-le toi-même": use every CLI and API before asking the user to click something.
- One page, one goal, one call to action repeated: no menu that leads visitors away.
- Never print, commit or log the Lumail key.
- Reply with the live URL, the Lumail tag the signups get, and what is left to do.
