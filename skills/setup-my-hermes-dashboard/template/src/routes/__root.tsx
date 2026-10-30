import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import * as React from "react";

import { SectionMark } from "@/components/brand";
import { HubFrame, savedCollapsed } from "@/components/hub/sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { savedTheme } from "@/lib/theme";
import { getLinks } from "@/server/functions";

import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";

import styles from "../styles.css?url";

const DESCRIPTION = "Your Hermes agent at a glance, with the modules you ask it for.";

export const Route = createRootRoute({
  beforeLoad: () => ({ theme: savedTheme(), collapsed: savedCollapsed() }),
  // Read once per visit: the public Hermes address only changes with a redeploy, and who is signed in with a sign-in.
  loader: () => getLinks(),
  staleTime: Infinity,
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
  errorComponent: ({ error }) => <Fallback title="Could not load the page" detail={error instanceof Error ? error.message : "Unknown error"} alert />,
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
  const { theme, collapsed } = Route.useRouteContext();
  const links = Route.useLoaderData();
  const hermesUrl = links?.hermesUrl ?? null;
  // Before the loader answers (an error page), act as a member: nothing admin-only shows.
  const viewer = links?.viewer ?? { email: null, role: "member" as const };
  useReloadOnStaleChunks();
  return (
    <html lang="en" className={theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeProvider saved={theme}>
          <HubFrame initialCollapsed={collapsed} hermesUrl={hermesUrl} viewer={viewer}>
            {children}
          </HubFrame>
          <Toaster position="bottom-right" />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
