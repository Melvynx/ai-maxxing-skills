import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { authComponent } from "./auth";
import { normalizeEmail, ownerEmail, roleOf, type Role } from "./lib";
import { role } from "./schema";

export type Viewer = { email: string; role: Role };
export type Member = { email: string; role: Role; owner: boolean; addedAt: number | null };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 3_600_000;
const LIMITS = { send: 5, verify: 15 } as const;

/** Who is signed in, or null: no session, or the email was removed from the members since. */
export const me = query({
  args: {},
  handler: async (ctx): Promise<Viewer | null> => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    const found = await roleOf(ctx, user.email);
    return found ? { email: normalizeEmail(user.email), role: found } : null;
  },
});

async function requireAdmin(ctx: QueryCtx): Promise<Viewer> {
  const user = await authComponent.safeGetAuthUser(ctx);
  const found = user ? await roleOf(ctx, user.email) : null;
  if (!user || found !== "admin") throw new ConvexError("Only an admin can do this");
  return { email: normalizeEmail(user.email), role: found };
}

async function allMembers(ctx: QueryCtx): Promise<Member[]> {
  const owner = ownerEmail();
  const rows = await ctx.db.query("members").collect();
  const list: Member[] = rows.map((m) => ({ email: m.email, role: m.email === owner ? "admin" : m.role, owner: m.email === owner, addedAt: m.addedAt }));
  if (owner && !list.some((m) => m.owner)) list.push({ email: owner, role: "admin", owner: true, addedAt: null });
  return list.sort((a, b) => Number(b.owner) - Number(a.owner) || a.role.localeCompare(b.role) || a.email.localeCompare(b.email));
}

async function addMember(ctx: MutationCtx, email: string, as: Role, by: string | undefined, invite: boolean) {
  const normalized = normalizeEmail(email);
  if (!EMAIL.test(normalized)) throw new ConvexError("Not a valid email address");
  const existing = await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", normalized))
    .unique();
  if (existing) {
    if (existing.role !== as) await ctx.db.patch(existing._id, { role: as });
  } else if (normalized !== ownerEmail()) {
    await ctx.db.insert("members", { email: normalized, role: as, addedAt: Date.now(), addedBy: by });
  }
  if (invite) await ctx.scheduler.runAfter(0, internal.email.sendInvite, { email: normalized, by });
  return { email: normalized, role: as };
}

async function removeMember(ctx: MutationCtx, email: string, by: string | null) {
  const normalized = normalizeEmail(email);
  if (normalized === ownerEmail()) throw new ConvexError("The owner cannot be removed");
  if (by && normalized === by) throw new ConvexError("You cannot remove yourself");
  const existing = await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", normalized))
    .unique();
  if (!existing) throw new ConvexError(`${normalized} has no access`);
  await ctx.db.delete(existing._id);
  return { email: normalized };
}

/** The Team page: everyone who can sign in. Admins only. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return allMembers(ctx);
  },
});

/** Gives someone access as a member. `invite` emails them the link. Admins only. */
export const add = mutation({
  args: { email: v.string(), invite: v.boolean() },
  handler: async (ctx, { email, invite }) => {
    const admin = await requireAdmin(ctx);
    return addMember(ctx, email, "member", admin.email, invite);
  },
});

/** Takes someone's access away, at once: their next page load sends them to the sign-in page. Never the owner or yourself. */
export const remove = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const admin = await requireAdmin(ctx);
    const target = await roleOf(ctx, email);
    if (target === "admin") throw new ConvexError("An admin can only be removed from the server (dashboard member remove)");
    return removeMember(ctx, email, admin.email);
  },
});

// From the server only (`dashboard member ...`, which runs `convex run` with the deploy key): any role, admins too.

export const serverList = internalQuery({ args: {}, handler: (ctx) => allMembers(ctx) });

export const serverAdd = internalMutation({
  args: { email: v.string(), role, invite: v.boolean() },
  handler: (ctx, { email, role: as, invite }) => addMember(ctx, email, as, undefined, invite),
});

export const serverRemove = internalMutation({
  args: { email: v.string() },
  handler: (ctx, { email }) => removeMember(ctx, email, null),
});

// Used by Better Auth (auth.ts) before a code is sent or checked.

export const isAllowed = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => (await roleOf(ctx, email)) !== null,
});

/** "limited" past the hourly limit for this email, else whether it may sign in. Counted for every email, members or not. */
export const signInCheck = internalMutation({
  args: { email: v.string(), step: v.union(v.literal("send"), v.literal("verify")) },
  handler: async (ctx, { email, step }): Promise<"allowed" | "refused" | "limited"> => {
    const key = `${step}:${normalizeEmail(email)}`;
    const hour = Math.floor(Date.now() / HOUR);
    const row = await ctx.db
      .query("attempts")
      .withIndex("by_key", (q) => q.eq("key", key).eq("hour", hour))
      .unique();
    if (row && row.count >= LIMITS[step]) return "limited";
    if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
    else await ctx.db.insert("attempts", { key, hour, count: 1 });
    return (await roleOf(ctx, email)) ? "allowed" : "refused";
  },
});
