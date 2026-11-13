import { createFileRoute } from "@tanstack/react-router";

import { withViewer } from "@/server/chat/http";
import { serveChatFrame } from "@/server/chat/media";
import { getViewer } from "@/server/viewer";

/** The sandboxed page the chat's live HTML previews run in (`GET /api/hermes-chat/frame`). Admins only. */
export const Route = createFileRoute("/api/hermes-chat/frame")({
  server: { handlers: { GET: () => withViewer(getViewer, (viewer) => serveChatFrame(viewer)) } },
});
