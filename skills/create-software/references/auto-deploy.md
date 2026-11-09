# Auto deploy on every push

Every app goes live on its own each time code lands on `main`: a GitHub Action deploys the Convex functions first, then builds the site against the prod Convex URLs and deploys it to Cloudflare Workers. Set it up in the same change as the first deploy, never later. Nobody deploys by hand after that, the agent included: commit, push, watch the run.

## 1. Prod Convex URLs in `.env.production`

`vite build` reads `.env.production` over `.env.local`, so the build never points at the dev deployment. These two values are public (they ship in the browser bundle), so the file is committed:

```bash
# .env.production
VITE_CONVEX_URL=https://<prod-deployment>.convex.cloud
VITE_CONVEX_SITE_URL=https://<prod-deployment>.convex.site
```

Take them from `npx convex deploy` output or `npx convex dashboard --prod`. Never put a secret in this file.

## 2. The workflow

`.github/workflows/deploy.yml`. Fill the account id (`cf accounts list`), match the package manager to the lockfile (shown with pnpm; for npm use `npm ci`, `npx`, and `cache: npm` without the pnpm step) and pin `cf` to the version `cf --version` prints:

```yaml
name: Deploy

# Every push to main goes live: Convex functions first (when CONVEX_DEPLOY_KEY is set),
# then the site is built against the prod Convex URLs (.env.production) and deployed to Cloudflare Workers.

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
      CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_DEPLOY_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Deploy Convex
        if: env.CONVEX_DEPLOY_KEY != ''
        run: pnpm exec convex deploy -y
      - run: pnpm exec vite build
      - name: Deploy to Cloudflare
        run: pnpm dlx cf@<cf-version> deploy --prebuilt
```

`pnpm/action-setup` reads the version from `packageManager` in `package.json`; add that field if it is missing. Prod Convex env vars (`BETTER_AUTH_SECRET`, `LUMAIL_API_KEY`...) stay in `npx convex env set --prod`, Worker secrets stay in Cloudflare: the Action never holds them.

## 3. The two GitHub secrets

Secrets go straight from the source to GitHub with `gh secret set`, never through the chat, a file or a log.

**`CLOUDFLARE_API_TOKEN`**: a token that can only deploy Workers on this account and zone. First try to create it yourself (find the permission group ids with `cf user tokens permission-groups list`): name it `GitHub Actions deploy: <app>`, with Workers Scripts Write and Account Settings Read on the account, Workers Routes Write, Zone Read and DNS Write on the app's zone. Pipe the returned value into `gh secret set CLOUDFLARE_API_TOKEN --repo <owner>/<repo>` without printing it.

If `cf` answers `9109 Unauthorized` (the browser login cannot create tokens), the user makes it. Give them https://dash.cloudflare.com/profile/api-tokens and these exact steps: "Create Token", template "Edit Cloudflare Workers", Account Resources = their account, Zone Resources = the app's domain, "Continue to summary", "Create Token", copy it. Then give them this command to run in their own terminal, which asks for the value without showing it, and wait for "done":

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo <owner>/<repo>
```

**`CONVEX_DEPLOY_KEY`**: a production deploy key. Open the prod dashboard with `npx convex dashboard --prod`, tell the user to go to Settings, "Generate Production Deploy Key", copy it, then run `gh secret set CONVEX_DEPLOY_KEY --repo <owner>/<repo>` and paste it. Until it is set, the Action skips the Convex step and still deploys the site, so say it plainly: a change in `convex/` will not go live until this key is there.

## 4. Prove it

Commit and push, then `gh run watch --exit-status` on the run (`gh run list --workflow deploy.yml -L 1`). Fix and push again until it is green, then open the live URL and check the change you pushed is there. Write in `AGENTS.md`: "Deploy = push to main. Watch it with `gh run watch`. Never deploy by hand."
