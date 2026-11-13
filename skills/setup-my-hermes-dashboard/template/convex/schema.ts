import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const role = v.union(v.literal("admin"), v.literal("member"));

export default defineSchema({
  /** Who may sign in, and with which role. Nobody else gets a code. The owner (DASHBOARD_OWNER) is always an admin. */
  members: defineTable({
    email: v.string(),
    role,
    addedAt: v.number(),
    addedBy: v.optional(v.string()),
  }).index("by_email", ["email"]),
  /** Sign-in attempts per email and per hour, to stop code guessing and email flooding. */
  attempts: defineTable({
    key: v.string(),
    hour: v.number(),
    count: v.number(),
  }).index("by_key", ["key", "hour"]),
});
