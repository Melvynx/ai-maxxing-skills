import { createRootRoute, HeadContent, Outlet, redirect, Scripts } from "@tanstack/react-router";
import * as React from "react";

import { SectionMark } from "@/components/brand";
import { HubFrame, savedCollapsed, savedMonitoringOpen } from "@/components/hub/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { SIGNED_OUT } from "@/lib/session";
import { savedTheme } from "@/lib/theme";
import { getSession, type Session } from "@/server/functions";

import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";

import styles from "../styles.css?url";

const DESCRIPTION = "Your Hermes agent at a glance, with the modules you ask it for.";

/**
 * The session, asked on the server for every page it renders and at most once a minute in the browser (the server
 * functions behind each page still check it on every call, so a removed member loses access at once).
 */
let known: { session: Session; at: number } | null = null;
async function session(): Promise<Session> {
  if (typeof window === "undefined") return getSession();
  if (known && known.session.viewer && Date.now() - known.at < 60_000) return known.session;
  known = { session: await getSession(), at: Date.now() };
  return known.session;
}

export const Route = createRootRoute({
  // Every page needs a session, except the sign-in page itself.
  beforeLoad: async ({ location }) => {
    const current = await session();
    if (!current.viewer && location.pathname !== "/login") {
      throw redirect({ to: "/login", search: { redirect: location.pathname === "/" ? undefined : location.href } });
    }
    return { theme: savedTheme(), collapsed: savedCollapsed(), monitoringOpen: savedMonitoringOpen(), session: current };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "color-scheme", content: "light dark" },
      { title: "Hermes" },
      { name: "description", content: DESCRIPTION },
      { name: "application-name", content: "Hermes" },
      { name: "apple-mobile-web-app-title", content: "Hermes" },
      // One tag only (TanStack keeps a single meta per name); lib/theme.ts switches it with the theme.
      { name: "theme-color", content: "#f9f9fa" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Hermes" },
      { property: "og:title", content: "Hermes" },
      { property: "og:description", content: DESCRIPTION },
    ],
    links: [
      { rel: "stylesheet", href: styles },
      // Every page's text uses it: fetched with the CSS instead of after it is parsed.
      { rel: "preload", href: geistLatin, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  component: () => <Outlet />,
  notFoundComponent: () => <Fallback testId="not-found" title="Page not found" detail="This page does not exist (anymore)." />,
  errorComponent: ({ error }) => <PageError error={error} />,
  shellComponent: RootDocument,
});

function Fallback({ title, detail, alert, testId }: { title: string; detail: string; alert?: boolean; testId?: string }) {
  return (
    <main className="mx-auto grid min-h-[70dvh] max-w-sm place-content-center justify-items-center gap-3 p-6 text-center" role={alert ? "alert" : undefined} data-testid={testId}>
      <SectionMark section="hermes" className="mb-2 size-9" />
      <h1 className="text-lg font-semibold tracking-[-0.01em]">{title}</h1>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <a className="mt-2 inline-flex h-8 items-center rounded-lg border bg-card px-3 text-meta font-medium shadow-panel hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none" href="/">
        Back to home
      </a>
    </main>
  );
}

/** A session that ended while the page was open (signed out elsewhere, removed from the team): back to sign-in. */
function PageError({ error }: { error: unknown }) {
  const signedOut = error instanceof Error && error.message === SIGNED_OUT;
  React.useEffect(() => {
    if (!signedOut) return;
    known = null;
    window.location.assign(`/login?redirect=${encodeURIComponent(window.location.pathname)}`);
  }, [signedOut]);
  if (signedOut) return null;
  return <Fallback title="Could not load the page" detail={error instanceof Error ? error.message : "Unknown error"} alert />;
}

/** A tab opened before a deploy asks for chunks that no longer exist: reload once instead of silently failing. */
function useReloadOnStaleChunks() {
  React.useEffect(() => {
    const onError = (event: Event) => {
      const last = Number(sessionStorage.getItem("hermes-chunk-reload") ?? 0);
      if (Date.now() - last < 15_000) return;
      sessionStorage.setItem("hermes-chunk-reload", String(Date.now()));
      event.preventDefault();
      window.location.reload();
    };
    window.addEventListener("vite:preloadError", onError);
    return () => window.removeEventListener("vite:preloadError", onError);
  }, []);
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const { theme, collapsed, monitoringOpen, session: current } = Route.useRouteContext();
  const viewer = current?.viewer ?? null;
  useReloadOnStaleChunks();
  return (
    <html lang="en" className={theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider saved={theme}>
          {/* Signed out (the sign-in page): no rail, nothing of the dashboard shows. */}
          {viewer ? (
            <HubFrame initialCollapsed={collapsed} initialMonitoringOpen={monitoringOpen} hermesUrl={current?.hermesUrl ?? null} viewer={viewer}>
              {children}
            </HubFrame>
          ) : (
            children
          )}
          <Toaster position="bottom-right" />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
