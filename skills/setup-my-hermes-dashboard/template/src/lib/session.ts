/** The message a server function throws when the session is gone: the root then sends the browser to the sign-in page. */
export const SIGNED_OUT = "Sign in to continue";

/** Where to go after signing in: only a path of this dashboard, never another site. */
export function safeRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.startsWith("/login") || value.startsWith("/api/")) return "/";
  return value;
}
