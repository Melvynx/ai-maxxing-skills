import { createFileRoute } from "@tanstack/react-router";

import { withViewer } from "@/server/chat/http";
import { serveChatMedia } from "@/server/chat/media";
import { getViewer } from "@/server/viewer";

/** A server media file Hermes shows in the chat: `GET /api/hermes-chat/media?path=<server path>[&download=1]` (Range). Admins only. */
export const Route = createFileRoute("/api/hermes-chat/media")({
  server: { handlers: { GET: ({ request }) => withViewer(getViewer, (viewer) => serveChatMedia(viewer, request)) } },
});
