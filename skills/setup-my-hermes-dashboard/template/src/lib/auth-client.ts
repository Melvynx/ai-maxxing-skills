import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Better Auth in the browser: calls /api/auth/* on this same address, which passes them to Convex. */
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
