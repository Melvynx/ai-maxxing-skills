# Product rules

Lessons from shipping a production support inbox. Apply every section that matches the app, and turn each applicable rule into a task with a `Check:` line in `SPEC.md`. Ship the structure the user asked for before polishing it.

## URLs

- Path-based, with slugs: `/:org/:section/:status/:id`. Query params are for true filters only (`?tag=billing&q=refund`).
- One pure URL builder, used by the UI, webhooks, API, CLI, emails and notifications. Grep that no other code assembles these paths.
- Reserve every top-level route name (`login`, `api`, `admin`, `settings`, `assets`...) so no slug can shadow it.
- A short permanent link (`/:org/c/:id`) for anything sent outside the app.
- Renaming a route keeps the old one as a redirect, because links already live in old emails and chats.
- An unknown or stale id goes to the nearest valid page with a toast. Queries return `null` for a missing record instead of throwing, or the page loops on the error.
- Derive the current selection from the location, not from params that lag a navigation behind. Tests assert the settled URL.

## Sign-in and access

- Decide in the brief: open signup, or invite-only with no signup.
- Invite-only: an unknown email gets the same answer as a known one, with no code sent and no row created. Nothing may reveal whether an account exists. OAuth and every other door follow the same rule.
- Rate limit codes per email and per IP (about 5 sends per hour, 10 sign-in attempts per 15 minutes).
- Each person edits their own profile, signature and preferences without admin rights.
- Remove test data, QA names and leftover test accounts before launch.

## Language

- UI in English by default, in natural product wording. Add a test that fails when a hard-coded string in another language appears in the source, with an allowlist for fixtures.
- Customer-facing content (emails, agent replies) goes out in the customer's language. Never translate user data.
- Keep stored enum values stable and translate only their labels.

## Sending things

- If the app sends anything, it has a real composer: an always-visible "New message" button, the `c` shortcut and a palette entry. A reply-only app is a bug.
- Composer: From picker, To / Cc / Bcc as validated chips with autocomplete, rich text editor, attachments, signature, a 5 s undo, a draft that survives a reload and Esc.
- API and CLI can send too.
- Sending addresses are limited to a domain the org has verified. Check on the server.
- Status changes when the send happens, not when it is queued.

## Search

- Global by default: every scope and status, archived included. A record reachable only by link is a bug.
- Accent- and case-insensitive, prefix matching, terms ANDed, across person name, full email, local part, domain, subject, body, tags and ids.
- Same search from every entry point: the list box, `/`, `⌘K`, the API and the CLI.
- Results show status, scope, date and a highlighted snippet. Opening one works even when archived, and Esc returns to the previous list.

## Tags and labels

- Each tag has a kind (topic, product, stage) and a scope. Show a tag only where it applies, never every tag everywhere.
- Show counts, sort by count, hide zeros, fold beyond 8 behind "More...".
- System tags that automations read are protected: renaming and deleting are blocked, with the reason in a tooltip.
- Deleting a used tag is refused or offers a merge. Merges re-tag in batches.

## Agent-first apps

- Core function, UI door, API door: one function behind each button, API route and CLI command. The API and CLI reach every action a person has.
- The human UI is action buttons and proposals with buttons, not a chat box.
- Agent runs are visible in the app: a Journal per run or per record with webhooks, API calls, actions, status and errors, plus one global feed. Nobody should need a terminal to see what happened.
- Actors show human names, never API-key names or raw ids.
- Money actions need a human click. Proposals never execute themselves.
- Triggers are idempotent: one reply per burst of messages (a window of about 60 s), one run at a time per conversation, dedupe by delivery id, skip when already answered.
- A reply guard refuses a second reply when the conversation moved past what the agent read.
- Agents working from corrections need a filter: test traffic can teach them the wrong policy.

## Webhooks

- Signed: HMAC of `<timestamp>.<body>`, compared in constant time, rejected outside ±300 s.
- Retries with backoff (1 min, 5 min, 30 min, 2 h, 12 h), then `failed`, with a manual Redeliver in the app. A redelivery gets a new delivery id.
- Refuse private and internal hosts as webhook URLs, and do not follow redirects.
- Log payloads with secrets masked, and expire logs (30 days).

## Notifications

- Durable outbox table: pending, sent (with the provider's message id), updated. Retries with backoff and a visible alert on failure.
- One rich card per item, edited in place through its lifecycle (New, Working, Needs you, Done). Mention a person only when a human must act, once per episode.
- Store each button click as an event before acting on it. Double clicks are one answer.
- Never show raw ids in a notification: use the name, the subject and a deep link.

## HTML email rendering

- Isolate inbound HTML in a shadow DOM (`:host { all: initial }`) or a sandboxed iframe. No app CSS reaches it, none of its CSS escapes.
- Force a light color scheme on a white sheet. Text inheriting the dark theme's light color on white is the classic bug: test an unstyled `h1`, `p` and `td` in both themes.
- Optional per-message dark toggle: invert and hue-rotate the document, re-invert images and video.
- Fold quoted history behind "•••" (Gmail, Outlook, Apple and `>` quotes), unfolded when nothing earlier explains the message.
- Store the provider's returned Message-ID so replies thread. Merge related mail from the same contact only inside one scope.

## Data

- Never use user strings as object keys in stored documents or Convex return values. Convex field names must be ASCII, so one emoji tag crashes the write. Use arrays of `{ name, count }`, and keep an emoji case in tests.
- All writes to a record go through one helper that keeps counters and search text exact.
- Migrations are idempotent, with a dry run that reports counts first. Run until a re-run changes 0.
- Watch read limits on bulk jobs, and process in batches.

## Deploy and machine limits

- Deploy from a clean checkout of the pushed commit (`git archive` or CI), never from a dirty tree. Check that HEAD did not move during the build.
- Backend and frontend deploy separately: ship both, and verify a string from the new code in the live bundle.
- Add CI that deploys on push to `main` once the first manual deploy works.
- On small machines, limit parallel coding agents and headless browsers: one browser at a time, closed after each check, or the kernel kills the run.
