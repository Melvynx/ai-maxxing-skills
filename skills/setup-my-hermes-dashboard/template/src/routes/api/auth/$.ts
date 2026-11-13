import { createFileRoute } from "@tanstack/react-router";

import { authServer } from "@/server/auth";

/** Better Auth's endpoints, passed to Convex: the session cookie stays on the dashboard's own address. */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => authServer().handler(request),
      POST: ({ request }) => authServer().handler(request),
    },
  },
});
