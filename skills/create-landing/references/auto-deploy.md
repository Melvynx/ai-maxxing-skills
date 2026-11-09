# Auto deploy on every push

The landing goes live on its own each time code lands on `main`: a GitHub Action builds the site and deploys it to Cloudflare Workers. Set it up in the same change as the first deploy, never later. Nobody deploys by hand after that, the agent included: commit, push, watch the run.

## 1. The workflow

`.github/workflows/deploy.yml`. Fill the account id (`cf accounts list`), match the package manager to the lockfile (shown with pnpm; for npm use `npm ci`, `npx`, and `cache: npm` without the pnpm step) and pin `cf` to the version `cf --version` prints:

```yaml
name: Deploy

# Every push to main builds the site and deploys it to Cloudflare Workers.

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      CLOUDFLARE_ACCOUNT_ID: <account-id>
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec vite build
      - name: Deploy to Cloudflare
        run: pnpm dlx cf@<cf-version> deploy --prebuilt
```

`pnpm/action-setup` reads the version from `packageManager` in `package.json`; add that field if it is missing. `LUMAIL_API_KEY` stays a Cloudflare secret on the Worker: the Action never holds it.

## 2. The GitHub secret

`CLOUDFLARE_API_TOKEN` goes straight from Cloudflare to GitHub with `gh secret set`, never through the chat, a file or a log. It is a token that can only deploy Workers on this account and zone.

First try to create it yourself (find the permission group ids with `cf user tokens permission-groups list`): name it `GitHub Actions deploy: <site>`, with Workers Scripts Write and Account Settings Read on the account, Workers Routes Write, Zone Read and DNS Write on the site's zone. Pipe the returned value into `gh secret set CLOUDFLARE_API_TOKEN --repo <owner>/<repo>` without printing it.

If `cf` answers `9109 Unauthorized` (the browser login cannot create tokens), the user makes it. Give them https://dash.cloudflare.com/profile/api-tokens and these exact steps: "Create Token", template "Edit Cloudflare Workers", Account Resources = their account, Zone Resources = the site's domain, "Continue to summary", "Create Token", copy it. Then give them this command to run in their own terminal, which asks for the value without showing it, and wait for "done":

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo <owner>/<repo>
```

## 3. Prove it

Commit and push, then `gh run watch --exit-status` on the run (`gh run list --workflow deploy.yml -L 1`). Fix and push again until it is green, then open the live URL and check the change you pushed is there. Add an `AGENTS.md` at the site root (or a line in the existing one): "Deploy = push to main. Watch it with `gh run watch`. Never deploy by hand."
