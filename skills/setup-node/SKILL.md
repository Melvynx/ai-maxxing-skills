---
name: setup-node
description: Install Node.js and npm on macOS, Linux or Windows without an admin password, so npx, npm install -g and the CLIs that need them work. Use when node, npm or npx is missing or "command not found", or before setup-cloudflare, setup-convex, setup-lumail or setup-dev-browser.
---

Get a working Node.js LTS with `npm` and `npx` for the current user. Do it yourself and only ask the user for what needs a human. Talk to them in their language, short messages, no jargon (never say "PATH", "prefix" or "LTS" to them).

1. Check first: if `node --version` prints v20 or higher and `npm --version` works, say so and stop.
2. Find the OS with `uname -s` (`Darwin` is macOS, `Linux` is Linux); if it fails or PowerShell answers, it is Windows.
3. Install:
   - macOS and Linux: run [scripts/install-node.sh](scripts/install-node.sh). On macOS with Homebrew it uses `brew install node`; otherwise it downloads the official Node LTS into `~/.local/node` and adds it to the user's shell config, with no admin password.
   - Windows: `winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements`, then ask the user to close and reopen the Claude session.
4. The current session does not see the new install yet: prefix your next commands with `export PATH="$HOME/.local/node/bin:$PATH"` (macOS and Linux without Homebrew), or ask the user to open a new session.
5. Make sure global installs work without admin rights: run `npm config get prefix`. If `npm install -g` fails with `EACCES`, run `npm config set prefix ~/.local` and make sure `~/.local/bin` is in the shell config. Never use `sudo npm`.
6. Prove it: `node --version && npm --version && npx --version`, then `npx -y cowsay ok` prints a cow.

Reply with the Node version and where it is installed, in one line.
