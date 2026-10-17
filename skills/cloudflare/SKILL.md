---
name: cloudflare
description: "Everything Cloudflare through the official `cf` CLI (no Wrangler, no raw API calls): domains, DNS records, Workers (dev, build, deploy, secrets, routes, crons), custom domains, KV, D1, R2 buckets and file uploads, Pages, Queues, Tunnels, SSL, WAF, cache purge, Zero Trust, email routing, analytics. Use when the user mentions Cloudflare, cf, DNS, a domain, deploy, workers, KV, D1, R2, CDN, SSL or cache."
---

# Cloudflare (via `cf`)

Every Cloudflare action uses the official `cf` CLI (`npm i -g cf`, binary `cf`). Never Wrangler, never an S3 SDK script, never raw calls to api.cloudflare.com. If the user's machine already has the official Cloudflare connector in Claude, it can help for reads, but `cf` stays the tool for changes.

## Setup and auth

```bash
cf --version                 # missing: npm i -g cf
cf auth whoami               # must say "authenticated": true
cf auth login                # OAuth in the browser, the user approves (grant every scope, sensitive ones included)
```

- If several accounts are visible, `cf` stops with "More than one account available": run `cf accounts list` (or `cf cli search "list accounts"`), then `export CLOUDFLARE_ACCOUNT_ID=<id>` for the session.
- Zone-scoped commands take `-z <domain or zone id>`.
- Never print tokens or read the `cf` config file.

## Find the right command

```bash
cf cli search "<what you want to do, generic words>"   # JSON matches
cf <discovered command> --help                           # flags of that one command
cf schema <same command without the leading cf>          # exact API request body
```

Every mutating command accepts `--dry-run`. Deletes ask for confirmation: pass `--force` only after the user said yes.

## Common jobs

| job | command |
| --- | --- |
| zones (domains) | `cf zones list` |
| DNS list / add | `cf dns records list -z <domain>` · `cf dns records create -z <domain> --body '{"type":"CNAME","name":"www","content":"target","proxied":true}'` |
| DNS update / delete | `cf cli search "update dns record"` |
| Worker project | `cf init <dir>` · `cf dev` · `cf build` · `cf deploy` |
| custom domain on a Worker | `cf cli search "worker custom domain"` |
| Worker secrets, routes, crons | `cf cli search "worker secret"` / `"worker routes"` / `"cron triggers"` |
| KV | `cf cli search "kv namespace"` / `"write kv value"` |
| D1 | `cf cli search "d1 query"` |
| R2 | `cf r2 buckets list` · `cf r2 objects put <key> --bucket-name <bucket> --file <path> --content-type <mime>` |
| cache purge | `cf cli search "purge cache"` |
| SSL, WAF, Access, email routing, DNSSEC, analytics | `cf cli search "<job>"` |
| local simulation | add `--local` (KV, D1, R2 objects) |

Exact subcommand names follow the CLI release: if a command above errors, `cf cli search` it.

## DNS records given by another service

When a service (Lumail, Stripe, Google, a mail provider) shows DNS records to add, create each one exactly as given (type, name, content, priority, TTL), keep mail and verification records unproxied (`"proxied": false`), then list the zone to confirm they exist.

## Rules

- `cf` only. If `cf` cannot do something, say so and stop.
- Confirm before anything destructive (DNS deletes, zone changes, purges).
- Keep `cf cli search` queries generic (action + resource type, no names or ids).
