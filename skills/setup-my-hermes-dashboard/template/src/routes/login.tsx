import { createFileRoute, redirect } from "@tanstack/react-router";
import { ArrowLeft, Mail } from "lucide-react";
import * as React from "react";

import { SectionMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { safeRedirect } from "@/lib/session";

/**
 * The only way in: an email, then the 6-digit code sent to it. Only members of the team get a code (Team page, or
 * `dashboard member add` on the server); anyone else sees the same screen but never receives anything.
 */
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => (search.redirect ? { redirect: safeRedirect(search.redirect) } : {}),
  beforeLoad: ({ context, search }) => {
    if (context.session.viewer) throw redirect({ href: safeRedirect(search.redirect) });
  },
  head: () => ({ meta: [{ title: "Sign in · Hermes" }] }),
  component: LoginPage,
});

const CODE = /^\d{6}$/;

function LoginPage() {
  const { redirect: next } = Route.useSearch();
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [step, setStep] = React.useState<"email" | "code">("email");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const codeInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failed } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
    setBusy(false);
    if (failed) return setError(failed.message ?? "Could not send the code, try again");
    setCode("");
    setStep("code");
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failed } = await authClient.signIn.emailOtp({ email: email.trim(), otp: code });
    if (failed) {
      setBusy(false);
      setCode("");
      return setError(failed.code === "INVALID_OTP" || failed.status === 400 ? "Wrong or expired code" : (failed.message ?? "Could not sign in, try again"));
    }
    // A full load: the whole dashboard renders again with the new session.
    window.location.assign(safeRedirect(next));
  }

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10" data-testid="login">
      <div className="grid w-full max-w-sm gap-6">
        <div className="grid justify-items-center gap-3 text-center">
          <SectionMark section="hermes" className="size-10" />
          <div className="grid gap-1">
            <h1 className="text-xl font-semibold tracking-[-0.02em]">{step === "email" ? "Sign in to Hermes" : "Check your email"}</h1>
            <p className="text-sm text-muted-foreground">
              {step === "email" ? (
                "We email you a 6-digit code. No password."
              ) : (
                <>
                  If <span className="font-medium text-foreground">{email.trim()}</span> has access, a code is on its way.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-panel">
          {step === "email" ? (
            <form onSubmit={sendCode} className="grid gap-3" data-testid="login-email">
              <label className="grid gap-1.5 text-sm font-medium">
                Email
                <Input type="email" autoComplete="email" autoFocus required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} />
              </label>
              <Button type="submit" disabled={!validEmail || busy}>
                <Mail className="size-4" aria-hidden />
                {busy ? "Sending…" : "Email me a code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={signIn} className="grid gap-3" data-testid="login-code">
              <label className="grid gap-1.5 text-sm font-medium">
                Code
                <Input
                  ref={codeInput}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="text-center font-mono text-lg tracking-[0.4em]"
                  aria-describedby="code-help"
                />
              </label>
              <Button type="submit" disabled={!CODE.test(code) || busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              <p id="code-help" className="text-center text-xs text-muted-foreground">
                The code works for 10 minutes. You stay signed in for 30 days on this browser.
              </p>
            </form>
          )}
          {error ? (
            <p className="mt-3 text-sm text-bad" role="alert" data-testid="login-error">
              {error}
            </p>
          ) : null}
        </div>

        {step === "code" ? (
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground" onClick={() => (setStep("email"), setError(null))}>
              <ArrowLeft className="size-3.5" aria-hidden /> Other email
            </button>
            <button type="button" className="text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={busy} onClick={() => void sendCode()}>
              Send a new code
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
