import { createFileRoute } from "@tanstack/react-router";

import { json, withKey } from "@/server/api";

/** Which key is calling: `dashboard-cli get /api/v1/whoami` proves the key works before a module relies on it. */
export const Route = createFileRoute("/api/v1/whoami")({
  server: {
    handlers: {
      GET: withKey("dashboard:read", ({ key }) => json({ key: key.name, scopes: [...key.scopes].sort() })),
    },
  },
});
