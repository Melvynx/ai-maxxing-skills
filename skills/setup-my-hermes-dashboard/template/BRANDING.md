# Branding: make the dashboard look like its owner's brand

The dashboard ships in a neutral "Hermes" look. This recipe dresses it in the owner's own brand: their name, logo, colors and font, from the sign-in page to the browser tab and the sign-in emails. Run it when the owner asks ("put my dashboard in my colors", "use my branding", "my site is acme.com"), or right after the install when they want it.

## 1. Get the brand

Ask the owner one question: **"What's your website? Or send me your logo, your main color and your font."** A website is enough: take everything from it.

From a website (open it in a browser, or `curl -sL <url>` and read the HTML and CSS):

- **Name**: the brand as people say it (the logo text, `og:site_name`, the `<title>` without its tagline). Add "Hub" or "Dashboard" only if the owner wants it ("Acme Hub").
- **Tagline**: one short, warm line for the sign-in page, in the brand's voice and language. Under 60 characters.
- **Logo**: the square mark, not the wide wordmark. Look for `apple-touch-icon`, `icon` links, `og:image`, the header `<svg>`. Prefer SVG; else a PNG of at least 512 px.
- **Main color**: the color of their buttons and links (CSS variables such as `--primary`, `--brand`, `--accent`, or the main button's `background`). One color, the one people recognize.
- **Font**: the `font-family` of their headings or body. Note it only if it's on Google Fonts or Fontsource.

Write what you found in 5 lines and show it to the owner before changing anything. Keep a copy of the logo and the source page in `branding/` at the repo root.

## 2. Apply it

All the brand lives in a few places. Change only these:

| what | where |
|---|---|
| Name, tagline, logo path | `src/lib/brand.ts` (`BRAND`) |
| Logo file | `public/logo.svg` (or `.png`), then `logo: "/logo.svg"` in `BRAND` |
| Main color | `src/styles.css`: `--brand`, `--brand-foreground`, `--brand-ink`, `--brand-soft`, in `:root` **and** `.dark` |
| The drawn mark (when there is no logo) | `src/styles.css`: `--mark-from`, `--mark-to`, `--mark-ink`, `--mark-soft`, `--mark-softer` |
| Font | `src/styles.css`: the `@import` lines at the top and `--font-sans` in `@theme inline` |
| Icons of the tab and the installed app | `public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (logo at 70 % on the brand color) |
| Installed app name | `public/site.webmanifest`: `name`, `short_name`, `theme_color` |
| One-line description | `DESCRIPTION` in `src/routes/__root.tsx` |
| Name in the emails | the sender's display name: `EMAIL_FROM="Acme Hub <hub@acme.com>"` (Convex variable, `dashboard deploy` sets it from `expose mail`). The emails read the brand from it. |

Color rules, so it stays readable:

- `--brand` is the main color as is. `--brand-foreground` is the text on it: white unless the color is light (yellow, lime, light green), then near black. Check the contrast is at least 4.5:1.
- `--brand-ink` is the brand color as text on white: darken it until it reaches 4.5:1 on `--background`.
- `--brand-soft` is a pale tint for backgrounds (the brand at about 10 % on white).
- In `.dark`: `--brand` a little lighter, `--brand-ink` light enough to read on the dark background, `--brand-soft` the brand at about 15 % opacity.
- The mark tokens are a gradient of the same hue: `--mark-from` lighter, `--mark-to` darker, `--mark-ink` the color itself, `--mark-soft` and `--mark-softer` two pale tints.
- Never change the status colors (`--good`, `--warn`, `--bad`): green, orange and red must keep meaning ok, careful and broken.
- Keep every color in `styles.css`: the dashboard forbids inline `style=""`.

Font: install it with `pnpm add @fontsource-variable/<font>` (or `@fontsource/<font>` when there is no variable version), replace the `@fontsource-variable/geist` import, and put its name first in `--font-sans`. Keep Geist Mono for numbers and code.

Icons: from an SVG logo, `npx -y sharp-cli -i public/logo.svg -o public/icon-512.png resize 512 512` and the same for each size; `favicon.svg` can be the logo itself. If the logo is not square, center it on a square of the brand color.

## 3. Check and ship

1. `dashboard deploy` (it typechecks, tests and builds; the old version stays online if something fails).
2. Look at the sign-in page signed out, then the home, in light and dark: the logo is sharp, buttons are in the brand color, text on them is readable, nothing is still indigo.
3. Commit and push: `git add -A && git commit -m "Branding: <brand>" && git push`.
4. Tell the owner in two lines what changed, and that the next sign-in email will come with the new name if `EMAIL_FROM` was changed.
