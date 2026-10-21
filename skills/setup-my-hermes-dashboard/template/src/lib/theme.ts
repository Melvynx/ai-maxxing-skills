import { readCookie, writeCookie } from "@/lib/cookie";

export type Theme = "light" | "dark";

/** Browser chrome colour per theme: the page background (--background in styles.css). */
const THEME_COLOR = { light: "#f9f9fa", dark: "#09090b" } as const;

/** Saved in a cookie (not localStorage) so the server renders <html class="dark"> without any inline script. */
const THEME_COOKIE = "hermes-theme";

/** The saved theme, or null when the user never chose (then the OS preference applies after hydration). */
export function savedTheme(): Theme | null {
  const value = readCookie(THEME_COOKIE);
  return value === "light" || value === "dark" ? value : null;
}

export const saveTheme = (theme: Theme) => writeCookie(THEME_COOKIE, theme);

export function systemTheme(): Theme {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Applies the light/dark theme to <html> and keeps the theme-color meta (mobile browser bar) in step. `color-scheme`
 * follows the class in styles.css: nothing is written to the style attribute.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}
