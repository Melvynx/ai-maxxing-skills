import { createFileRoute } from "@tanstack/react-router";

import { json } from "@/server/api";
import { getApp } from "@/server/app";

/** Open check for the deploy script and uptime probes: is the dashboard up, and does it reach Hermes? */
export const Route = createFileRoute("/api/v1/health")({
  server: {
    handlers: {
      GET: async () => {
        const hermes = await getApp()
          .hermes.status()
          .then((status) => status.overall)
          .catch(() => "unreachable");
        return json({ ok: true, hermes });
      },
    },
  },
});
