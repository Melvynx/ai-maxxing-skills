import { createFileRoute } from "@tanstack/react-router";

import { HubHome } from "@/components/hub/home";
import { getHome } from "@/server/functions";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  staleTime: 30_000,
  head: () => ({ meta: [{ title: "Home · Hermes" }] }),
  component: () => <HubHome summary={Route.useLoaderData()} />,
});
