# Organizations (multi-tenant)

Decide this before the data model. Adding organizations later means rewriting every table, query, URL, API key and permission check, then backfilling live data while people use the app. Adding `orgId` on day one costs one field and one index.

## Decide

Ask the user directly, with your recommendation, and write the answer and its reason in `SPEC.md`.

- Yes when the app has any of: team members, shared inboxes or shared data, roles, invitations, billing per company, agents or API keys per workspace.
- No for a single-user tool: each person sees only their own data, and the only admin is the owner.
- When the user expects teams "later", choose yes.

If no, skip this file. If yes, everything below is in v1.

## Data model

- Tables: `organizations` (name, unique slug), `memberships` (orgId, userId, role), `invitations` (orgId, email, role, expiresAt, acceptedAt).
- Every tenant table has `orgId`, and every index starts with it (`by_org_and_status`).
- One helper, `requireMember(ctx, orgId, minRole)`, is the first line of every public query and mutation. Never trust an `orgId` from the client without it.
- Any other id in the arguments: load the document and compare its `orgId` with the current org. Apply this at every door: uploads, file links, webhooks, API, CLI.
- "Not a member" and "does not exist" return the same answer, so an id or slug reveals nothing.
- Billing belongs to the org: the Stripe customer is on `organizations`, not on the user.

## URLs

- Org pages live at `/:org/...` with human slugs, settings at `/:org/settings/...`.
- Never put an org or record id in query params. `/app?org=<id>&inbox=<id>` loops on `not_found` as soon as one id goes stale.
- Slugs are unique, editable, and checked against a reserved list. URL rules are in [product-rules.md](product-rules.md).

## Roles

- Three roles: owner, admin, member. Write what each one can do in `SPEC.md`, per action.
- Add capability rules on top of roles where the risk calls for it, such as "money actions need a specific role and a human click". An API key or agent cannot satisfy a human-click rule.
- Enforce roles on the server. Hiding a button is only the UI's half.
- The last owner cannot leave or be demoted.
- API keys belong to an org. A key stops working as soon as its creator loses the role that allowed it.

## Invitations

- Owners and admins invite by email with a role. Invitations expire, work once, and can be revoked.
- Removing a member takes effect at once, in open sessions as well.

## Org switcher

- At the top of the sidebar: lists the user's orgs, and shows a simple label when there is only one.
- `/` redirects to the last used org, or to the only one.
- Switching keeps the current section when it exists in the target org, otherwise lands on that org's home.

## Platform admin and org admin

- An org admin runs one org, in `/:org/settings`. A platform admin runs the product, in `/admin`.
- Platform admins come from an env var list (`PLATFORM_ADMINS`), never from a row a user can edit.
- Decide who creates orgs and write it in `SPEC.md`: anyone at signup (SaaS), or platform admins only (invite-only app).

## Check before saying done

With two orgs and a user in each: user A cannot read or write org B through a URL, the API, the CLI or a file link. A member calling an admin mutation directly is refused. An invited user lands in the right org with the right role. A removed member loses access without reloading.
