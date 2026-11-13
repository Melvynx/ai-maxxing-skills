import { createFileRoute } from "@tanstack/react-router";

import { getApp } from "@/server/app";
import { controlRequest, withViewer } from "@/server/chat/http";
import { getViewer } from "@/server/viewer";

/** `POST /api/hermes-chat/runs/<id>/stop | approval | clarify`: controls a run of the viewer's. Admins only. */
export const Route = createFileRoute("/api/hermes-chat/runs/$id/$action")({
  server: { handlers: { POST: ({ request, params }) => withViewer(getViewer, (viewer) => controlRequest(viewer, request, params.id, params.action, getApp().chat)) } },
});
