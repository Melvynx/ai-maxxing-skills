import { createIsomorphicFn, getGlobalStartContext } from "@tanstack/react-start";
import { createRouter } from "@tanstack/react-router";
import { setNonce } from "get-nonce";

import { cspNonce } from "@/lib/nonce";

import { routeTree } from "./routeTree.gen";

const getNonce = createIsomorphicFn()
  .server(() => (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce)
  .client(() => {
    // Radix (react-remove-scroll / react-style-singleton) inserts <style> tags that must carry the CSP nonce. Set here
    // once for every page: a route's beforeLoad does not re-run while hydrating an SSR page.
    const nonce = cspNonce();
    if (nonce) setNonce(nonce);
    return nonce;
  });

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: false,
    // Hover/focus/touch on a <Link> loads the next page's code and loader data, so the click renders from cache.
    defaultPreload: "intent",
    // TanStack keeps a shown pendingComponent for 500 ms by default. `ssr: false` pages arrive with it already
    // rendered, so that floor delayed every reload of a cached page by half a second.
    defaultPendingMinMs: 0,
    ssr: { nonce: getNonce() },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
