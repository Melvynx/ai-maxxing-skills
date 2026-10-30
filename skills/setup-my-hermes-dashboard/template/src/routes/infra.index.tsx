import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/infra/")({
  beforeLoad: () => {
    throw redirect({ to: "/infra/health", replace: true });
  },
});
