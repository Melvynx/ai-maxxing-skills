---
name: server-tools
description: What this server can do and which command does each job - GitHub with gh, Cloudflare with cf, putting an app or site online at <name>.__DOMAIN__ with expose, the agent's own health with hermes-setup. Use whenever a task touches a GitHub repo, a domain or DNS, Cloudflare, publishing a site or an app, or checking which tools exist on this machine.
---

# Tools on this server

This is the owner's server, running 24/7. Every tool below is already signed in: never print a token, a key or a password, and never sign a tool out.

| job | command | check |
|---|---|---|
| GitHub: repos, clone, push, PRs, issues | `gh`, see the `github-cli` skill | `gh auth status` |
| Cloudflare: DNS, Workers, R2, KV, D1, cache | `cf`, see the `cloudflare` skill | `cf auth whoami` |
| Put an app online with HTTPS and the sign-in page | `expose` | `expose status` |
| The agent itself: model, chat, dashboard | `hermes-setup` | `hermes-setup check` |

## Cloudflare on this server

`cf` is signed in with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from `~/.config/cloudflare/env` (loaded by login shells and by the agent). That access only works from this server's address. If `cf` says it is not signed in, run the command through `bash -lc '<command>'`; never run `cf auth login` here.

## Put something online

1. Run the app as a service listening on `127.0.0.1:<port>` only.
2. `expose add <name>.__DOMAIN__ <port>`: it creates the address, HTTPS and the sign-in page in front.
3. `expose status` lists what is online; `expose remove <name>.__DOMAIN__` takes it down.

Never open a port in the firewall, never bind `0.0.0.0`, never publish a page another way. Every page sits behind the sign-in page: never use `expose allow` or `--public` unless the owner asks for that exact page or address. `expose unlock` clears a lock after too many wrong passwords.

## Rules

- Ask the owner before anything that can cut access or break what runs: SSH or firewall settings, a reboot, deleting files, containers or databases, an OS upgrade, anything public or paid.
- Delete with `trash <path>` when it is installed, never `rm -rf` on anything of value.
