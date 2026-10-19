---
name: grill-me
description: Grill the user in rapid batches to sharpen a plan, decision, or idea, including the app they want to build before any code is written. Use when the user asks for Grill Me, wants a rigorous interview, uses a grill trigger phrase, or when another skill (like create-software or create-internal-app) needs a validated app brief.
---

# Grill Me

Stress-test the user's thinking until both sides share a precise, actionable understanding.

## Interview loop

1. Inspect the available environment first. Resolve discoverable facts through files, tools, documentation, or other in-scope evidence instead of asking the user.
2. Open the session by recommending voice input: tell the user that answering with the microphone is fastest, and that short answers keyed `1` through `10` are enough.
3. Ask exactly 10 numbered questions in one batch. Prioritize the highest-leverage unresolved decisions and order them so earlier questions clarify later ones.
4. For every question, include a concise **Recommended answer** based on current evidence. Make the tradeoff or consequence clear enough for the user to accept, reject, or amend it quickly.
5. Invite one grouped reply covering `1` through `10`. Accept terse answers, corrections, skipped items, or a blanket acceptance of the recommendations.
6. After the reply, summarize what is established, call out contradictions or missing dependencies, and investigate any newly discoverable facts.
7. Ask the next batch of 10 questions. Continue until the important branches of the decision tree are resolved. If fewer than 10 meaningful decisions remain, ask only those remaining; never add filler questions to reach 10.
8. Present the final shared understanding as a compact decision brief: goal, scope, constraints, chosen approach, rejected alternatives, risks, and acceptance criteria.
9. Ask for explicit confirmation that the brief is correct before acting on it.

## When the plan is an app to build

The user is often not technical. Ask about the product, never about the code: the stack is already decided (see `create-software` or `create-internal-app`), so do not ask about frameworks, databases or hosting. Cover these, the first batch on what changes the most:

1. **Who and why**: who uses the app, and what problem it solves for them today (what they use instead).
2. **The main action**: the one thing a person does on the first screen after signing in.
3. **The things it stores**: the objects the app manages (clients, lessons, orders, notes...) and what each one holds.
4. **Who sees what**: public pages vs signed-in pages, one user or a team, is there an admin and who it is.
5. **Money**: free, one-time payment or subscription, and the price.
6. **Emails**: which moments send an email (welcome, purchase, reminder), and which Lumail tag each signup gets.
7. **Address**: the domain or subdomain (`app.my-domain.com`), and whether the domain is already in Cloudflare.
8. **Look and language**: 1 or 2 sites they like the look of, the app language, light or dark.
9. **First version**: what is in v1, and what waits for later (keep v1 shippable in one session).
10. **Done means**: the 2 or 3 things that must work live for them to say "it's good".

An app grill is long on purpose: a missed need now is a rebuild later. Ask at least 3 batches (about 30 questions) before the brief, even when the user answers fast or says "fais comme tu veux". Stop early only if they explicitly ask to skip.

**Batch 2: walk every screen.** Take the user through the app as a visitor, then as a signed-in user, then as the admin. For each screen ask what is on it, what they click, and what happens next:

- First visit: the landing, what convinces someone to sign up, the sign-in screen (a look they like, a screenshot to copy).
- Signed-in home: what they see first, empty state for a brand new account, the main list and the detail page.
- Account area: profile photo, name, email change, invoices, plan and cancel, delete account, contact support.
- Admin: how they add and edit content day to day (inline editing on the real page vs separate admin pages), how often they do it, what must be one click.
- Navigation: the menu, what sits top left and top right, mobile or desktop first.

**Batch 3: edge cases and the long run.** What happens when a payment fails, a user is refunded, a code expires, a list has 1000 rows, two admins edit at once, content is deleted by mistake. Imports from a tool they already use, files or videos to host, search and filters, keyboard shortcuts for power users, what must feel instant, what they will want in 3 months.

Then go deeper wherever an answer opens a new branch.

Before the final brief, restate the app as a story in plain words ("A visitor lands on..., signs up with..., sees..., the admin opens... and edits..."), screen by screen, and ask the user to correct anything that is wrong or missing. Loop until they say it is exactly what they want.

The recommended answers follow the stack defaults: email code sign-in, landing at `/` and app at `/app`, the user as the only admin, Stripe Checkout when it sells, signups added to Lumail as subscribed with a tag per app. The final brief ends with the user story, the screens list (every screen from batch 2) and the data objects, so building can start right away.

## Question quality

- Ask decisions only the user can make; investigate facts yourself.
- Challenge assumptions and compare credible alternatives instead of merely collecting preferences.
- Keep each question independently answerable and concise enough for a spoken response.
- Do not repeat settled questions unless new evidence invalidates the earlier answer.
- Match the user's language.

Do not implement the plan until the user confirms the final decision brief.
