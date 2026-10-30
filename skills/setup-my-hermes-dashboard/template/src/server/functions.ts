import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getApp } from "@/server/app";
import { SCOPES, type PublicKey } from "@/server/db/api-keys";
import type { HermesStatus } from "@/server/hermes";
import { getViewer, requireAdmin, type Viewer } from "@/server/viewer";

/**
 * What the pages read and change. Pages sit behind the gate of the server (sign-in or saved IP), so these need no
 * key. The gate also says who is there (see viewer.ts): members see the modules, only admins get the Hermes link and
 * the API keys. A Hermes read is caught on its own: a stopped Hermes shows as "unavailable" instead of breaking the page.
 */
export const orNull = <T>(promise: Promise<T>) => promise.catch(() => null);

export type HomeSummary = {
  owner: string;
  hermesUrl: string | null;
  status: HermesStatus | null;
  model: string | null;
};

export const getHome = createServerFn({ method: "GET" }).handler(async (): Promise<HomeSummary> => {
  const { hermes, settings } = getApp();
  const admin = getViewer().role === "admin";
  const [status, model] = await Promise.all([orNull(hermes.status()), orNull(hermes.model())]);
  return { owner: settings.owner, hermesUrl: admin ? settings.hermesUrl : null, status, model };
});

export const getLinks = createServerFn({ method: "GET" }).handler(async (): Promise<{ hermesUrl: string | null; viewer: Viewer }> => {
  const viewer = getViewer();
  return { hermesUrl: viewer.role === "admin" ? getApp().settings.hermesUrl : null, viewer };
});

/** Null for a member: the page then says the keys are for admins. */
export const listKeys = createServerFn({ method: "GET" }).handler(async (): Promise<PublicKey[] | null> =>
  getViewer().role === "admin" ? getApp().keys.list() : null,
);

export const createKey = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().trim().regex(/^[\w .@:-]{1,60}$/u),
      scopes: z.array(z.enum(SCOPES)).min(1),
      days: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    requireAdmin();
    const expiresAt = data.days ? Math.floor(Date.now() / 1000) + data.days * 86_400 : null;
    return getApp().keys.create(data.name, data.scopes, expiresAt);
  });

export const revokeKey = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().regex(/^key_[0-9a-f]{16}$/) }))
  .handler(async ({ data }) => {
    requireAdmin();
    return { key: getApp().keys.revoke(data.id) };
  });
