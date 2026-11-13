/**
 * Who this dashboard belongs to: the one place for its name and words. The colors are the `--brand*` and `--mark-*`
 * tokens of `styles.css`, the font is `--font-sans` there, the icons are in `public/`. BRANDING.md (repo root) says how
 * to make it match someone's own brand.
 */
export const BRAND = {
  /** Shown in the menu, the tab titles, the sign-in page and the installed app. */
  name: "Hermes",
  /** One short line under the name on the sign-in page. */
  tagline: "Your agent, your numbers, one place.",
  /** A logo file in `public/` (for example "/logo.svg"), shown instead of the drawn mark. Empty = the drawn mark. */
  logo: "",
};

/** "Home · Hermes". */
export function pageTitle(...parts: string[]) {
  return [...parts, BRAND.name].join(" · ");
}
