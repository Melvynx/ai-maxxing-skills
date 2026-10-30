import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getApp } from "@/server/app";
import { toConversations, type Conversation } from "@/server/conversations";
import { SCOPES, type PublicKey } from "@/server/db/api-keys";
import type { HermesStatus } from "@/server/hermes";
import type { Tone } from "@/server/infra/model";
import { chooseModel, readModels, type ChooseAnswer, type ModelsData } from "@/server/models";
import { getViewer, requireAdmin, type Viewer } from "@/server/viewer";

/**
 * What the pages read and change. Pages sit behind the gate of the server (sign-in or saved IP), so these need no
 * key. The gate also says who is there (see viewer.ts): members see the modules, only admins get System monitoring
 * (Conversations, Infra, Models, the Hermes link) and the API keys. A Hermes read is caught on its own: a stopped Hermes shows as "unavailable" instead of breaking the page.
 */
export const orNull = <T>(promise: Promise<T>) => promise.catch(() => null);

export type HomeSummary = {
  owner: string;
  admin: boolean;
  hermesUrl: string | null;
  status: HermesStatus | null;
  model: string | null;
  /** The last Infra check, for admins only (null for members, or before the first check). */
  infra: { at: number; tone: Tone; bad: number; warn: number } | null;
};

export const getHome = createServerFn({ method: "GET" }).handler(async (): Promise<HomeSummary> => {
  const { hermes, settings, infra } = getApp();
  const admin = getViewer().role === "admin";
  const [status, model] = await Promise.all([orNull(hermes.status()), orNull(hermes.model())]);
  const run = admin ? infra.health.latest() : null;
  const glance = run && { at: run.at, tone: run.tone, bad: run.checks.filter((c) => c.tone === "bad").length, warn: run.checks.filter((c) => c.tone === "warn").length };
  return { owner: settings.owner, admin, hermesUrl: admin ? settings.hermesUrl : null, status, model, infra: glance };
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

/** Null for a member. `conversations` is null when Hermes does not answer. */
export type ConversationsPage = { now: number; conversations: Conversation[] | null };

/** The latest Hermes sessions, every platform together. */
export const getConversations = createServerFn({ method: "GET" }).handler(async (): Promise<ConversationsPage | null> => {
  if (getViewer().role !== "admin") return null;
  const data = await orNull(getApp().hermes.api("/api/sessions?limit=30&order=recent"));
  return { now: Date.now(), conversations: data === null ? null : toConversations(data) };
});

/** Null for a member. `models` is null when Hermes does not answer. */
export type ModelsPage = { models: ModelsData | null };

export const getModels = createServerFn({ method: "GET" }).handler(async (): Promise<ModelsPage | null> => {
  if (getViewer().role !== "admin") return null;
  return { models: await orNull(readModels(getApp().hermes)) };
});

/** Hermes's main model: used from the next conversation on. */
export const setModel = createServerFn({ method: "POST" })
  .validator(
    z.object({
      provider: z.string().regex(/^[\w.-]{1,80}$/),
      model: z.string().regex(/^[\w.:/@+-]{1,200}$/),
      confirmed: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }): Promise<ChooseAnswer> => {
    requireAdmin();
    return chooseModel(getApp().hermes, data);
  });
