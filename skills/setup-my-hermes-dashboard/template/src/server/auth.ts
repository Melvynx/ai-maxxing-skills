import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";

type AuthServer = ReturnType<typeof convexBetterAuthReactStart>;

/**
 * The Convex deployment that holds the sign-in (convex/): read at run time from the service settings (CONVEX_URL and
 * CONVEX_SITE_URL in /etc/dashboard.env), or from .env.local in development (`npx convex dev` writes the VITE_ ones).
 */
export function convexUrls() {
  const env = import.meta.env as Record<string, string | undefined>;
  const url = process.env.CONVEX_URL || env.VITE_CONVEX_URL || "";
  const siteUrl = process.env.CONVEX_SITE_URL || env.VITE_CONVEX_SITE_URL || "";
  return url && siteUrl ? { url, siteUrl } : null;
}

let server: AuthServer | null = null;

/** Better Auth on the server side: the /api/auth proxy to Convex and the Convex calls made as the signed-in person. */
export function authServer(): AuthServer {
  if (server) return server;
  const urls = convexUrls();
  if (!urls) throw new Error("Sign-in is not set up: CONVEX_URL and CONVEX_SITE_URL are missing (run `dashboard deploy`)");
  server = convexBetterAuthReactStart({
    convexUrl: urls.url,
    convexSiteUrl: urls.siteUrl,
    // The Convex token is read from its cookie instead of a round trip to Convex on every page; an expired one is fetched again.
    jwtCache: { enabled: true, expirationToleranceSeconds: 0, isAuthError: (e) => /auth/i.test(e instanceof Error ? e.message : String(e)) },
  });
  return server;
}
