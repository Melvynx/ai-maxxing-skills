import { createServerFn } from "@tanstack/react-start";
import { ConvexError } from "convex/values";
import { z } from "zod";

import { getApp } from "@/server/app";
import { claudeAccountsFile, readClaudeAccounts, type ClaudeAccounts } from "@/server/claude-accounts";
import { toConversations, type Conversation } from "@/server/conversations";
import { SCOPES, type PublicKey } from "@/server/db/api-keys";
import type { HermesStatus } from "@/server/hermes";
import type { Tone } from "@/server/infra/model";
import { chooseModel, readModels, type ChooseAnswer, type ModelsData } from "@/server/models";
import { authServer } from "@/server/auth";
import { adminOrNull, getViewer, requireAdmin, requireViewer, type Viewer } from "@/server/viewer";

import { api } from "../../convex/_generated/api";
import type { Member } from "../../convex/members";

/**
 * What the pages read and change. Each one first checks the session (see viewer.ts): signed out, it throws and the
 * browser goes to the sign-in page. Members see the modules, only admins get System monitoring (Conversations, Infra,
 * Models, the Hermes link), the API keys and the Team page. A Hermes read is caught on its own: a stopped Hermes shows as "unavailable" instead of breaking the page.
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
  const admin = (await requireViewer()).role === "admin";
  const [status, model] = await Promise.all([orNull(hermes.status()), orNull(hermes.model())]);
  const run = admin ? infra.health.latest() : null;
  const glance = run && { at: run.at, tone: run.tone, bad: run.checks.filter((c) => c.tone === "bad").length, warn: run.checks.filter((c) => c.tone === "warn").length };
  return { owner: settings.owner, admin, hermesUrl: admin ? settings.hermesUrl : null, status, model, infra: glance };
});

/** Who is signed in (null: the sign-in page) and, for an admin, the public Hermes address. */
export type Session = { viewer: Viewer | null; hermesUrl: string | null };

export const getSession = createServerFn({ method: "GET" }).handler(async (): Promise<Session> => {
  const viewer = await getViewer();
  return { viewer, hermesUrl: viewer?.role === "admin" ? getApp().settings.hermesUrl : null };
});

/** Null for a member: the page then says the keys are for admins. */
export const listKeys = createServerFn({ method: "GET" }).handler(async (): Promise<PublicKey[] | null> =>
  (await adminOrNull()) ? getApp().keys.list() : null,
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
    await requireAdmin();
    const expiresAt = data.days ? Math.floor(Date.now() / 1000) + data.days * 86_400 : null;
    return getApp().keys.create(data.name, data.scopes, expiresAt);
  });

export const revokeKey = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().regex(/^key_[0-9a-f]{16}$/) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    return { key: getApp().keys.revoke(data.id) };
  });

/** A refusal from Convex ("You cannot remove yourself") reaches the page as its plain message. */
async function plain<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === "string") throw new Error(error.data);
    throw error;
  }
}

/** Null for a member. */
export type TeamPage = { you: string; members: Member[] };

const email = z.string().trim().toLowerCase().email("Not a valid email address").max(160);

/** Who can sign in to the dashboard, with their role. */
export const getTeam = createServerFn({ method: "GET" }).handler(async (): Promise<TeamPage | null> => {
  const admin = await adminOrNull();
  if (!admin) return null;
  return { you: admin.email, members: await authServer().fetchAuthQuery(api.members.list, {}) };
});

/** Lets someone sign in as a member. `invite` emails them the link. */
export const addMember = createServerFn({ method: "POST" })
  .validator(z.object({ email, invite: z.boolean() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    return plain(authServer().fetchAuthMutation(api.members.add, data));
  });

/** Takes a member's access away. Never an admin, never yourself. */
export const removeMember = createServerFn({ method: "POST" })
  .validator(z.object({ email }))
  .handler(async ({ data }) => {
    await requireAdmin();
    return plain(authServer().fetchAuthMutation(api.members.remove, data));
  });

/** Null for a member. `conversations` is null when Hermes does not answer. */
export type ConversationsPage = { now: number; conversations: Conversation[] | null };

/** The latest Hermes sessions, every platform together. */
export const getConversations = createServerFn({ method: "GET" }).handler(async (): Promise<ConversationsPage | null> => {
  if (!(await adminOrNull())) return null;
  const data = await orNull(getApp().hermes.api("/api/sessions?limit=30&order=recent"));
  return { now: Date.now(), conversations: data === null ? null : toConversations(data) };
});

/** Null for a member. `models` is null when Hermes does not answer; `accounts` when its Claude accounts are not watched. */
export type ModelsPage = { now: number; models: ModelsData | null; accounts: ClaudeAccounts | null };

export const getModels = createServerFn({ method: "GET" }).handler(async (): Promise<ModelsPage | null> => {
  if (!(await adminOrNull())) return null;
  const { hermes, settings } = getApp();
  const [models, accounts] = await Promise.all([orNull(readModels(hermes)), readClaudeAccounts(claudeAccountsFile(settings.hermesHome))]);
  return { now: Date.now(), models, accounts };
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
    await requireAdmin();
    return chooseModel(getApp().hermes, data);
  });
