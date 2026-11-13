import { createFileRoute } from "@tanstack/react-router";

import { getApp } from "@/server/app";
import { startRequest, withViewer } from "@/server/chat/http";
import { getViewer } from "@/server/viewer";

/** `POST /api/hermes-chat/runs`: sends a message to Hermes (a new conversation without `conversationId`). Admins only. */
export const Route = createFileRoute("/api/hermes-chat/runs")({
  server: { handlers: { POST: ({ request }) => withViewer(getViewer, (viewer) => startRequest(viewer, request, getApp().chat)) } },
});
