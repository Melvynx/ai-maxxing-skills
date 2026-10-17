---
name: lumail
description: Manage Lumail email marketing from Claude with the Lumail CLI or MCP. Use for setup and login, sending domains and DNS, subscribers, tags, double opt-in, transactional emails (OTP codes), campaigns, workflows (automations), segments, API keys and analytics.
---

## Connect

```bash
npx lumail@latest setup --authenticate   # installs the Lumail MCP + skills for your agent, opens the browser to authorize
npx lumail@latest auth test              # checks the saved login
```

The Lumail onboarding also has a "copy the prompt" button that does the same. Once connected, prefer the Lumail MCP tools; fall back to the CLI (`lumail --help`, then `lumail <resource> --help`). Never invent flags. Pass `--json` when parsing, and never print API keys.

## Common jobs

| job | how |
| --- | --- |
| count or find subscribers | MCP `count_subscribers`, `get_subscriber` · CLI `lumail subscribers list`, `lumail subscribers get <email>` |
| add or update a subscriber with tags | MCP `add_subscriber` · CLI `lumail subscribers create --help` |
| tags | MCP `list_tags`, `get_or_create_tags` · CLI `lumail tags list`, `lumail tags create` |
| API key for the app (OTP emails, signups) | CLI `lumail tokens --help` (create it yourself, store it only in the app env) |
| transactional email (login code) | MCP `send_email` · CLI `lumail emails --help` |
| sending domain + web domain | CLI `lumail domain --help`, then add the DNS records it returns in Cloudflare yourself |
| anything else | `lumail tools list`, `lumail tools get <tool>`, `lumail tools run <tool> --params '<json>'` |

## Signups from your app

- Upsert the person on signup or purchase with a tag per product (`student`, `customer`, `<product-slug>`).
- Double opt-in is on by default: a new subscriber stays "pending confirmation" until they click the email. For buyers and account signups, create them as subscribed (skip double opt-in) so tag workflows fire right away.
- Use a single helper on the server for every Lumail call; the API key never reaches the browser.

## Campaigns and workflows

- Create campaigns and workflows as drafts. Send, schedule or publish only when the user asks.
- Before writing a campaign body or a workflow graph, load the format guide: MCP `get_skill` with `{"type":"campaign"}` or `{"type":"workflow"}`.
- Workflow: create it, read it back with `get_workflow`, configure the full graph in one call (trigger such as "tag added", then the email steps), with the exact `updatedAt` value; publish only on request.
- After any change, read back the saved object and render it to check content and links.

Reply in the user's language with what changed, a link, and anything left to do.
