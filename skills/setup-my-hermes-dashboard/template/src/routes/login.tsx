import { createFileRoute, redirect } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import * as React from "react";

import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { BRAND, pageTitle } from "@/lib/brand";
import { safeRedirect } from "@/lib/session";
import { cn } from "@/lib/utils";

type LoginSearch = { redirect?: string; email?: string; code?: string };

const CODE = /^\d{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_AFTER = 30;

/**
 * The only way in: an email, then the 6-digit code sent to it (or the button in that email, which carries the code and
 * signs in on its own). Only members of the team get a code (Team page, or `dashboard member add` on the server);
 * anyone else sees the same screens but never receives anything.
 */
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    ...(search.redirect ? { redirect: safeRedirect(search.redirect) } : {}),
    ...(typeof search.email === "string" ? { email: search.email.slice(0, 160) } : {}),
    // The router reads `code=123456` as a number: take it back as text.
    ...(search.code != null && CODE.test(String(search.code)) ? { code: String(search.code) } : {}),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.session.viewer) throw redirect({ href: safeRedirect(search.redirect) });
  },
  head: () => ({ meta: [{ title: pageTitle("Sign in") }] }),
  component: LoginPage,
});

type Step = "email" | "code" | "done";

function LoginPage() {
  const search = Route.useSearch();
  const next = safeRedirect(search.redirect);
  const fromLink = Boolean(search.email && search.code);
  const [email, setEmail] = React.useState(search.email ?? "");
  const [step, setStep] = React.useState<Step>(fromLink ? "code" : "email");
  const [direction, setDirection] = React.useState<1 | -1>(1);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const go = (to: Step, dir: 1 | -1 = 1) => {
    setDirection(dir);
    setError(null);
    setStep(to);
  };

  async function sendCode() {
    setSending(true);
    setError(null);
    const { error: failed } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
    setSending(false);
    if (failed) {
      setError(failed.status === 429 ? "Too many tries. Wait a minute, then try again." : (failed.message ?? "Could not send the code. Try again."));
      return false;
    }
    return true;
  }

  const signedIn = React.useCallback(() => {
    go("done");
    // A full load: the whole dashboard renders again with the new session.
    window.location.assign(next);
  }, [next]);

  return (
    <main className="auth-backdrop relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-12" data-testid="login">
      <div className="relative z-10 grid w-full max-w-[25rem] gap-7">
        <header className="grid justify-items-center gap-4 text-center">
          <div className="auth-mark rounded-[1.1rem] p-2">
            <BrandMark className="size-11" />
          </div>
          <div className="grid gap-1.5">
            <h1 className="text-[1.6rem] leading-tight font-semibold tracking-[-0.03em]" data-testid="login-title">
              {step === "email" ? `Welcome to ${BRAND.name}` : step === "code" ? "Check your inbox" : "You're in"}
            </h1>
            <p className="text-[0.9375rem] text-muted-foreground">
              {step === "email" ? (
                BRAND.tagline
              ) : step === "code" ? (
                <>
                  We sent a 6-digit code to <span className="font-medium break-all text-foreground">{email.trim()}</span>
                </>
              ) : (
                `Opening ${BRAND.name}…`
              )}
            </p>
          </div>
        </header>

        <div className="overflow-hidden rounded-2xl border bg-card shadow-float">
          <div key={step} className={cn("p-6 animate-in fade-in duration-200", direction === 1 ? "slide-in-from-right-3" : "slide-in-from-left-3")}>
            {step === "email" ? (
              <EmailStep
                email={email}
                onEmail={setEmail}
                sending={sending}
                onSubmit={async () => {
                  if (await sendCode()) go("code");
                }}
              />
            ) : step === "code" ? (
              <CodeStep
                email={email.trim()}
                linkCode={fromLink ? search.code : undefined}
                onResend={sendCode}
                resending={sending}
                onBack={() => go("email", -1)}
                onSignedIn={signedIn}
              />
            ) : (
              <div className="grid justify-items-center gap-3 py-4" data-testid="login-done">
                <span className="grid size-11 place-items-center rounded-full bg-good-soft text-good">
                  <Check className="size-5" aria-hidden />
                </span>
                <p className="text-sm text-muted-foreground">Signed in. One second…</p>
              </div>
            )}
            {error ? (
              <p className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert" data-testid="login-error">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mx-auto flex max-w-[22rem] flex-col items-center gap-2 text-center text-xs leading-5 text-muted-foreground">
          <LockKeyhole className="size-3.5" aria-hidden />
          <p className="text-balance">
            Only people invited to {BRAND.name} can sign in. No password to remember, and you stay signed in as long as you come back within a week.
          </p>
        </div>
      </div>
    </main>
  );
}

function EmailStep({ email, onEmail, sending, onSubmit }: { email: string; onEmail: (v: string) => void; sending: boolean; onSubmit: () => void }) {
  const valid = EMAIL.test(email.trim());
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !sending) onSubmit();
      }}
      className="grid gap-4"
      data-testid="login-email"
    >
      <label className="grid gap-2">
        <span className="text-sm font-medium">Email</span>
        <span className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
            required
            maxLength={160}
            placeholder="you@company.com"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            className="h-12 w-full rounded-xl border border-input bg-background pr-3 pl-10 text-base shadow-xs transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground/70 focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/15"
          />
        </span>
      </label>
      <Button type="submit" disabled={!valid || sending} className="group h-12 rounded-xl bg-brand text-[0.9375rem] text-brand-foreground hover:bg-brand/90">
        {sending ? (
          <>
            <LoaderCircle className="animate-spin" aria-hidden /> Sending your code…
          </>
        ) : (
          <>
            Continue with email
            <ArrowRight className="transition-transform group-hover:translate-x-0.5" aria-hidden />
          </>
        )}
      </Button>
      <p className="text-center text-xs text-muted-foreground">We'll email you a code. That's it.</p>
    </form>
  );
}

function CodeStep({
  email,
  linkCode,
  onResend,
  resending,
  onBack,
  onSignedIn,
}: {
  email: string;
  linkCode?: string;
  onResend: () => Promise<boolean>;
  resending: boolean;
  onBack: () => void;
  onSignedIn: () => void;
}) {
  const [code, setCode] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const [wrong, setWrong] = React.useState<string | null>(null);
  const [wait, setWait] = React.useState(linkCode ? 0 : RESEND_AFTER);
  const [resent, setResent] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait(wait - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const verify = React.useCallback(
    async (otp: string) => {
      setChecking(true);
      setWrong(null);
      const { error: failed } = await authClient.signIn.emailOtp({ email, otp });
      if (!failed) return onSignedIn();
      setChecking(false);
      setCode("");
      setWrong(
        failed.status === 429
          ? "Too many tries. Wait a minute, then ask for a new code."
          : failed.code === "INVALID_OTP" || failed.status === 400
            ? "That code is wrong or expired. Try again, or get a new one."
            : (failed.message ?? "Could not sign in. Try again."),
      );
      window.setTimeout(() => input.current?.focus(), 0);
    },
    [email, onSignedIn],
  );

  // The button in the email: fill the boxes, take the code out of the address bar, sign in.
  const usedLink = React.useRef(false);
  React.useEffect(() => {
    if (!linkCode || usedLink.current) return;
    usedLink.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    setCode(linkCode);
    void verify(linkCode);
  }, [linkCode, verify]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (CODE.test(code) && !checking) void verify(code);
      }}
      className="grid gap-5"
      data-testid="login-code"
    >
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium" id="code-label">
            Your code
          </span>
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-3" aria-hidden /> Use another email
          </button>
        </div>
        <CodeBoxes
          ref={input}
          value={code}
          disabled={checking}
          invalid={Boolean(wrong)}
          onChange={(value) => {
            setWrong(null);
            setCode(value);
            if (CODE.test(value)) void verify(value);
          }}
        />
      </div>

      {checking ? (
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="login-checking">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Checking your code…
        </p>
      ) : wrong ? (
        <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad" role="alert" data-testid="login-error">
          {wrong}
        </p>
      ) : (
        <p className="text-center text-xs leading-5 text-muted-foreground">Type or paste it, you're in as soon as it's complete. Or just tap the button in the email.</p>
      )}

      <div className="flex items-center justify-center border-t pt-4 text-sm text-muted-foreground">
        {resent && wait > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-good">
            <Check className="size-4" aria-hidden /> New code sent. Check your spam folder too.
          </span>
        ) : (
          <span>
            Nothing yet?{" "}
            <button
              type="button"
              disabled={wait > 0 || resending}
              onClick={async () => {
                if (await onResend()) {
                  setResent(true);
                  setWait(RESEND_AFTER);
                  setCode("");
                  input.current?.focus();
                }
              }}
              className="font-medium text-foreground tabular-nums underline-offset-4 hover:underline disabled:font-normal disabled:text-muted-foreground disabled:no-underline"
            >
              {resending ? "Sending…" : wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
            </button>
          </span>
        )}
      </div>
    </form>
  );
}

/** Six boxes over one real input: typing, pasting and the phone's code suggestion all just work. */
const CodeBoxes = React.forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void; disabled?: boolean; invalid?: boolean }>(
  function CodeBoxes({ value, onChange, disabled, invalid }, ref) {
    const [focused, setFocused] = React.useState(false);
    return (
      <div className={cn("relative", invalid && "animate-shake")} data-testid="code-boxes">
        <div className="grid grid-cols-6 gap-2" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => {
            const char = value[i];
            const active = focused && !disabled && (i === value.length || (value.length === 6 && i === 5));
            return (
              <div
                key={i}
                className={cn(
                  "grid h-14 place-items-center rounded-xl border bg-background font-mono text-2xl font-semibold tabular-nums shadow-xs transition-[border-color,box-shadow,opacity]",
                  char && "border-foreground/25",
                  active && "border-brand ring-4 ring-brand/15",
                  invalid && "border-bad/50",
                  disabled && "opacity-60",
                )}
              >
                {char ?? (active ? <span className="h-6 w-px animate-caret bg-foreground" /> : null)}
              </div>
            );
          })}
        </div>
        <input
          ref={ref}
          aria-labelledby="code-label"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={value}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
          data-1p-ignore
          data-lpignore="true"
          data-testid="code-input"
          className="absolute inset-0 size-full cursor-text bg-transparent text-transparent caret-transparent outline-none selection:bg-transparent"
        />
      </div>
    );
  },
);
