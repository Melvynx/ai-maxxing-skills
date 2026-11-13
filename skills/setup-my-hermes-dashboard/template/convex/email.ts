import { Lumail } from "@lumail/convex";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { normalizeEmail, siteUrl } from "./lib";

/** Every email goes through Lumail (LUMAIL_API_KEY, sender EMAIL_FROM on a domain verified in Lumail). */
const lumail = new Lumail(components.lumail, { testMode: false, apiKey: process.env.LUMAIL_API_KEY });

const from = () => process.env.EMAIL_FROM ?? "Dashboard <dashboard@example.com>";
const host = () => new URL(siteUrl()).host;

/** The sign-in code. Without a Lumail key (local tests) it is written to the Convex logs instead. */
export const sendCode = internalMutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, { email, code }) => {
    const to = normalizeEmail(email);
    if (!process.env.LUMAIL_API_KEY) {
      console.log(`[sign-in] LUMAIL_API_KEY not set, code for ${to}: ${code}`);
      return;
    }
    await lumail.sendEmail(ctx, {
      to,
      from: from(),
      subject: `${code} is your sign-in code`,
      markdown: `Your code to sign in to **${host()}**:\n\n# ${code}\n\nIt expires in 10 minutes. If you did not ask for it, ignore this email.`,
      transactional: true,
    });
  },
});

/** Tells a new member they can sign in, with the link. */
export const sendInvite = internalMutation({
  args: { email: v.string(), by: v.optional(v.string()) },
  handler: async (ctx, { email, by }) => {
    const to = normalizeEmail(email);
    if (!process.env.LUMAIL_API_KEY) {
      console.log(`[invite] LUMAIL_API_KEY not set, no invite sent to ${to}`);
      return;
    }
    const who = by ? `${by} gave you access to` : "You now have access to";
    await lumail.sendEmail(ctx, {
      to,
      from: from(),
      subject: `You can sign in to ${host()}`,
      markdown: `${who} **${host()}**.\n\n[Sign in](${siteUrl()}/login)\n\nEnter this email address, then the code you receive. No password needed.`,
      transactional: true,
    });
  },
});
