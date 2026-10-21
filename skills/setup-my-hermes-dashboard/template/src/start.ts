import { createMiddleware, createStart } from "@tanstack/react-start";

/**
 * Per-request CSP nonce. Every inline script TanStack emits (hydration payload) and every style tag Radix inserts
 * carries it; nothing else inline is allowed. A `style` attribute in server-rendered HTML is blocked (React props set
 * after hydration go through the CSSOM and pass), so components never render `style` props.
 *
 * There is no sign-in here on purpose: the app listens on 127.0.0.1 only, and the server's gate (sign-in page or saved
 * IP, in front of every published page) decides who reaches it. The API checks its own Bearer keys.
 */
const csp = createMiddleware().server(async ({ next, request }) => {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = btoa(String.fromCharCode(...bytes));
  const result = await next({ context: { nonce } });
  // The API sets its own stricter headers (src/server/api.ts).
  if (new URL(request.url).pathname.startsWith("/api/")) return result;
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  const headers = new Headers(result.response.headers);
  headers.set("Content-Security-Policy", policy);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  if ((headers.get("content-type") ?? "").includes("text/html")) headers.set("Cache-Control", "no-store");
  return { ...result, response: new Response(result.response.body, { status: result.response.status, statusText: result.response.statusText, headers }) };
});

export const startInstance = createStart(() => ({ requestMiddleware: [csp] }));
