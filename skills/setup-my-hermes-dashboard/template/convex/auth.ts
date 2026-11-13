import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { requireRunMutationCtx } from "@convex-dev/better-auth/utils";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";

import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import { siteUrl } from "./lib";

export const authComponent = createClient<DataModel>(components.betterAuth);

const SEND = "/email-otp/send-verification-otp";
const SIGN_IN = "/sign-in/email-otp";

/**
 * Sign-in by email code only: no password, no sign-up. A code is sent only to a member (see members.ts) and the
 * session has no end while it is used (renewed once a day of use) and ends after 7 days without a visit.
 */
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteUrl(),
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [siteUrl()],
    database: authComponent.adapter(ctx),
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    hooks: {
      // Before a code is sent or checked: a per-email limit, then the member check. Someone who is not a member gets
      // the same answer as a member (no way to find out who has access), but no code.
      before: createAuthMiddleware(async (c) => {
        if (c.path !== SEND && c.path !== SIGN_IN) return;
        const email = (c.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== "string") return;
        const run = requireRunMutationCtx(ctx);
        const check = await run.runMutation(internal.members.signInCheck, { email, step: c.path === SEND ? "send" : "verify" });
        if (check === "limited") throw new APIError("TOO_MANY_REQUESTS", { message: "Too many attempts for this email, try again in an hour" });
        if (check === "allowed") return;
        if (c.path === SEND) return c.json({ success: true });
        throw new APIError("BAD_REQUEST", { message: "Invalid OTP", code: "INVALID_OTP" });
      }),
    },
    // No account is ever created for someone who is not a member, whatever the route.
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const allowed = await requireRunMutationCtx(ctx).runQuery(internal.members.isAllowed, { email: user.email });
            if (!allowed) throw new APIError("FORBIDDEN", { message: "Unknown account" });
          },
        },
      },
    },
    plugins: [
      convex({ authConfig }),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        async sendVerificationOTP({ email, otp }) {
          await requireRunMutationCtx(ctx).runMutation(internal.email.sendCode, { email, code: otp });
        },
      }),
    ],
  });
