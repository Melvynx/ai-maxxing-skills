import type { QueryCtx } from "./_generated/server";

export type Role = "admin" | "member";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The owner set at deploy time (DASHBOARD_OWNER): always an admin, never removed, so the dashboard can never lock everyone out. */
export const ownerEmail = () => normalizeEmail(process.env.DASHBOARD_OWNER ?? "") || null;

/** The role of an email, or null when it may not sign in. */
export async function roleOf(ctx: QueryCtx, email: string): Promise<Role | null> {
  const normalized = normalizeEmail(email);
  if (normalized === ownerEmail()) return "admin";
  const member = await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", normalized))
    .unique();
  return member?.role ?? null;
}

/** The address the dashboard is reached at, for the links in emails and Better Auth's trusted origin. */
export const siteUrl = () => (process.env.SITE_URL ?? "http://127.0.0.1:8794").replace(/\/$/, "");
