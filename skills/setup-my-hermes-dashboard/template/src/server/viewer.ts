import { getRequestHeader } from "@tanstack/react-start/server";

export type Role = "admin" | "member";

/** Who is looking at the page: the email they signed in with (null on a saved IP or on the server itself) and their role. */
export type Viewer = { email: string | null; role: Role };

/**
 * The server's gate signs people in and passes `X-Gate-User` and `X-Gate-Role` with every request it lets through
 * (Caddy drops any copy a browser sends). A request without them comes from the server itself (Hermes, a cron, a
 * local test), so it is the owner. Any role other than admin counts as a member.
 */
export function viewerFrom(user: string | null | undefined, role: string | null | undefined): Viewer {
  const email = user?.trim().toLowerCase() || null;
  if (role == null || role.trim() === "") return { email, role: "admin" };
  return { email, role: role.trim().toLowerCase() === "admin" ? "admin" : "member" };
}

export const getViewer = (): Viewer => viewerFrom(getRequestHeader("x-gate-user"), getRequestHeader("x-gate-role"));

/** For admin-only server functions (API keys, anything that changes the dashboard for everyone). */
export function requireAdmin(): Viewer {
  const viewer = getViewer();
  if (viewer.role !== "admin") throw new Error("Only an admin can do this");
  return viewer;
}
