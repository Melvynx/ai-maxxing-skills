import { createFileRoute } from "@tanstack/react-router";

import { getApp } from "@/server/app";
import { uploadRequest, withViewer } from "@/server/chat/http";
import { getViewer } from "@/server/viewer";

/** `POST /api/hermes-chat/files`: a file joined to a chat message, kept on the server for Hermes. Admins only. */
export const Route = createFileRoute("/api/hermes-chat/files")({
  server: { handlers: { POST: ({ request }) => withViewer(getViewer, (viewer) => uploadRequest(viewer, request, getApp().settings.dataDir)) } },
});
