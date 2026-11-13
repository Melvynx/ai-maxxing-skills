import { createFileRoute } from "@tanstack/react-router";

import { HubHome } from "@/components/hub/home";
import { getHome } from "@/server/functions";
import { pageTitle } from "@/lib/brand";

export const Route = createFileRoute("/")({
  loader: () => getHome(),
  staleTime: 30_000,
  head: () => ({ meta: [{ title: pageTitle("Home") }] }),
  component: () => <HubHome summary={Route.useLoaderData()} />,
});
