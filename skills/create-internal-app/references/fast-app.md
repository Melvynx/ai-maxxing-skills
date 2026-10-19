# Fast app rules (TanStack Start + Convex)

Mandatory on every app. A click must feel instant: no blank screen, no layout jump, no spinner on a whole page.

## Router

```ts
createRouter({
  routeTree,
  scrollRestoration: true,
  defaultPreload: "intent",          // warm chunks + loaders on hover/focus
  defaultPreloadStaleTime: 30_000,
  defaultPendingComponent: () => null,
  defaultPendingMs: 200,             // no flash for fast navigations
  defaultPendingMinMs: 0,
  defaultNotFoundComponent: Page404,
  defaultErrorComponent: ErrorPage,
  context: { convexClient },
});
```

## Cache

- One `QueryClient` created in `useState`, with `defaultOptions.queries.staleTime: 30_000`.
- Data through `useSuspenseQuery(convexQuery(...))` (or `useQuery` + skeleton): Convex keeps it live, the cache makes back navigation instant.
- The session or auth token is read once in the root loader (server function) with `staleTime: Infinity`, not on every navigation.
- Detail pages have a `loader` that fetches their data (`context.convexClient.query(...)` on the client, or `queryClient.ensureQueryData`). With `defaultPreload: "intent"` it runs on hover, so the data is ready on click.

## Skeletons and loading states

- EVERY route has its own `pendingComponent`, layouts and redirect-only routes included. The global one renders nothing.
- The skeleton matches the real layout: same wrappers, grid, cards, sidebar. Use `Skeleton` from shadcn. Heights: `h-4` text, `h-5` card title, `h-8` heading, `h-9` button, `h-10` input. `rounded-full` avatars, `rounded-xl` cards.
- Client queries that can be `undefined` return the same skeleton inside the component, never `null` that pops in later.
- Every button that triggers an async action shows a loading state (`LoadingButton` / `loading` prop, disabled while pending). Toast on success and on error.
- Lists: paginate or virtualize (TanStack Virtual) past ~100 rows; keep the previous page on screen while the next loads.

## Convex reads

- `.withIndex()` on every query, never `.filter()`. Index name lists its fields (`by_org_and_status`).
- Bounded reads: `.take(n)` or `.paginate()`, never unbounded `.collect()`, never `.collect().length` for counts (keep a counter document).
- Big mutations in batches of `.take(100)` with `ctx.scheduler.runAfter(0, ...)` for the rest.

## Check before saying done

Click through every page with a throttled network: each one shows its own skeleton, hovering a link preloads it, no layout shift when data arrives, no button can be double-submitted.
