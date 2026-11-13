import { Lumail } from "@lumail/convex";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { normalizeEmail, siteUrl } from "./lib";

/** Every email goes through Lumail (LUMAIL_API_KEY, sender EMAIL_FROM on a domain verified in Lumail). */
const lumail = new Lumail(components.lumail, { testMode: false, apiKey: process.env.LUMAIL_API_KEY });

const from = () => process.env.EMAIL_FROM ?? "Dashboard <dashboard@example.com>";

/** The name people know the dashboard by: the sender's display name ("Acme Hub <hub@acme.com>"), else the web address. */
export function brandName(sender = from(), site = siteUrl()) {
  const name = sender.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
  return name || new URL(site).host;
}

/** The link that signs in on its own: the login page reads the email and the code from it. */
export function signInLink(email: string, code: string, site = siteUrl()) {
  return `${site}/login?${new URLSearchParams({ email, code })}`;
}

export function codeEmail(email: string, code: string) {
  const brand = brandName();
  return {
    subject: `Your code to sign in to ${brand}`,
    markdown: [
      "Hello,",
      `Here is your code to sign in to ${brand}:`,
      `# ${code}`,
      `[Sign in to ${brand} →](${signInLink(email, code)})`,
      "The code and the button work for 10 minutes. If you didn't ask to sign in, you can ignore this email: nobody gets in without it.",
    ].join("\n\n"),
  };
}

export function inviteEmail(by?: string) {
  const brand = brandName();
  return {
    subject: by ? `${by} invited you to ${brand}` : `You're invited to ${brand}`,
    markdown: [
      "Hello,",
      `${by ? `${by} gave you access to` : "You now have access to"} **${brand}**: everything the team's agent does, in one place.`,
      `[Open ${brand} →](${siteUrl()}/login)`,
      "Type this email address and we'll send you a 6-digit code. No password to create, and you stay signed in as long as you come back at least once a week.",
    ].join("\n\n"),
  };
}

/** The sign-in code. Without a Lumail key (local tests) it is written to the Convex logs instead. */
export const sendCode = internalMutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, { email, code }) => {
    const to = normalizeEmail(email);
    if (!process.env.LUMAIL_API_KEY) {
      console.log(`[sign-in] LUMAIL_API_KEY not set, code for ${to}: ${code} (${signInLink(to, code)})`);
      return;
    }
    await lumail.sendEmail(ctx, { to, from: from(), ...codeEmail(to, code), transactional: true });
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
    await lumail.sendEmail(ctx, { to, from: from(), ...inviteEmail(by), transactional: true });
  },
});
