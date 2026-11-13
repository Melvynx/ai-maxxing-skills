import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/** Sign-in counters older than a day are no longer needed. */
export const dropOldAttempts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const before = Math.floor(Date.now() / 3_600_000) - 24;
    for (const row of await ctx.db.query("attempts").take(500)) if (row.hour < before) await ctx.db.delete(row._id);
  },
});

const crons = cronJobs();
crons.daily("drop old sign-in counters", { hourUTC: 3, minuteUTC: 0 }, internal.crons.dropOldAttempts);
export default crons;
