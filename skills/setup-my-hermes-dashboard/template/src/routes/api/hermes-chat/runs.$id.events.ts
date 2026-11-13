import { createFileRoute } from "@tanstack/react-router";

import { getApp } from "@/server/app";
import { eventsRequest, withViewer } from "@/server/chat/http";
import { getViewer } from "@/server/viewer";

/** `GET /api/hermes-chat/runs/<id>/events?after=<seq>`: the run's events relayed from Hermes, as SSE. Admins only. */
export const Route = createFileRoute("/api/hermes-chat/runs/$id/events")({
  server: { handlers: { GET: ({ request, params }) => withViewer(getViewer, (viewer) => eventsRequest(viewer, request, params.id, getApp().chat)) } },
});
