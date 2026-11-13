import { createFileRoute } from "@tanstack/react-router";

import { ChatView } from "@/components/chat/chat-page";
import { AdminsOnly } from "@/components/hub/page";
import { pageTitle } from "@/lib/brand";
import { ChatSearchSchema } from "@/lib/chat/search";
import { getChatPage } from "@/server/chat-fns";

export const Route = createFileRoute("/chat")({
  validateSearch: ChatSearchSchema,
  loaderDeps: ({ search: { c, s } }) => ({ c, s }),
  loader: ({ deps }) => getChatPage({ data: { c: deps.c, s: deps.s } }),
  head: () => ({ meta: [{ title: pageTitle("Chat") }] }),
  component: ChatRoute,
});

function ChatRoute() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  if (!data) {
    return (
      <AdminsOnly title="The chat is for admins only" testId="chat-admins-only">
        Hermes can reach the server and every tool it has.
      </AdminsOnly>
    );
  }
  return <ChatView data={data} search={search} />;
}
