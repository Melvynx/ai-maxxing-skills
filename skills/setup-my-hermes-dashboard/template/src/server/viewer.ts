import { api } from "../../convex/_generated/api";
import { SIGNED_OUT } from "@/lib/session";

import { authServer } from "./auth";

export type Role = "admin" | "member";

/** Who is looking at the page: the email they signed in with and their role. */
export type Viewer = { email: string; role: Role };

/**
 * The signed-in person, from their session (convex/members.ts `me`), or null: no session, an expired one, or an email
 * that was removed from the team since. Nothing else counts: no header, no address, no request from the server itself.
 */
export async function getViewer(): Promise<Viewer | null> {
  try {
    return await authServer().fetchAuthQuery(api.members.me, {});
  } catch (error) {
    console.error("[auth] could not read the session:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** For every server function a page calls. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new Error(SIGNED_OUT);
  return viewer;
}

/** For admin-only server functions (API keys, Team, anything that changes the dashboard for everyone). */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.role !== "admin") throw new Error("Only an admin can do this");
  return viewer;
}

/** The admin, or null for a member (the page then says it is for admins). Signed-out people never get this far. */
export async function adminOrNull(): Promise<Viewer | null> {
  const viewer = await requireViewer();
  return viewer.role === "admin" ? viewer : null;
}
