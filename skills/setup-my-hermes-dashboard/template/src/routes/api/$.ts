import { createFileRoute } from "@tanstack/react-router";

import { fail } from "@/server/api";

const notFound = () => fail(404, "not_found", "No such API route: see GET /api/v1/health");

export const Route = createFileRoute("/api/$")({
  server: { handlers: { GET: notFound, POST: notFound, PUT: notFound, PATCH: notFound, DELETE: notFound } },
});
