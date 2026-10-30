import { createFileRoute } from "@tanstack/react-router";

import { AdminsOnly, Dot, Empty, Page, Table, Unavailable } from "@/components/hub/page";
import { Badge } from "@/components/ui/badge";
import { ago, count, dateTime } from "@/lib/format";
import { getConversations, type ConversationsPage as Data } from "@/server/functions";

export const Route = createFileRoute("/conversations")({
  loader: () => getConversations(),
  head: () => ({ meta: [{ title: "Conversations · Hermes" }] }),
  component: ConversationsPage,
});

const sourceName = (source: string) => (source === "cli" ? "CLI" : source[0]!.toUpperCase() + source.slice(1));

function ConversationsPage() {
  const data = Route.useLoaderData();
  if (!data) {
    return (
      <AdminsOnly title="Conversations are for admins" testId="conversations-admins-only">
        They are the owner's chats with the agent.
      </AdminsOnly>
    );
  }
  return <Conversations {...data} />;
}

function Conversations({ now, conversations }: Data) {
  return (
    <Page section="conversations" hint="Your latest conversations with Hermes, on every platform." testId="conversations">
      {conversations === null ? (
        <Unavailable what="Conversations" />
      ) : conversations.length === 0 ? (
        <Empty title="No conversation yet">Talk to Hermes and your conversations show up here.</Empty>
      ) : (
        <Table head={["Conversation", "Where", "Messages", "Last active"]}>
          {conversations.map((c) => (
            <tr key={c.id} data-testid="conversation-row">
              <td className="max-w-[28rem] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Dot tone={c.active ? "good" : "idle"} />
                  <span className="truncate font-medium" title={c.title}>
                    {c.title}
                  </span>
                  {c.active ? <span className="sr-only">(active)</span> : null}
                </div>
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <Badge variant="outline">{sourceName(c.source)}</Badge>
                {c.who ? <span className="ml-2 text-xs text-muted-foreground">{c.who}</span> : null}
              </td>
              <td className="px-3 py-2.5 text-xs tabular-nums">{count(c.messages)}</td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground" title={c.lastActive ? dateTime(c.lastActive) : undefined}>
                {ago(c.lastActive, now)}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Page>
  );
}
