import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

/** A UI preference cookie, readable during SSR so the first paint already matches it (no inline script, no flash). */
export const readCookie = createIsomorphicFn()
  .server((name: string): string | undefined => getCookie(name))
  .client((name: string): string | undefined => document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1]);

export function writeCookie(name: string, value: string) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
