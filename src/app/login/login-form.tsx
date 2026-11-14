"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

function messageFor(status: number, message?: string, code?: string) {
  if (status === 401) return "Wrong email or password.";
  if (code === "INVALID_ORIGIN") return "Sign-in is not allowed from this address. Ask your admin.";
  if (code === "ACCOUNT_LOCKED" || code === "IP_NOT_ALLOWED") return message!;
  if (status === 403) return message || "This account is deactivated.";
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  return "Could not sign in. Check the connection and try again.";
}

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // second step when the account has two-factor sign-in: a code from the authenticator app, or a recovery code
  const [step, setStep] = useState<"password" | "totp" | "recovery">("password");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      if (step === "password") {
        const { data, error } = await authClient.signIn.email({
          email: String(form.get("email")).trim(),
          password: String(form.get("password")),
        });
        if (error) {
          setError(messageFor(error.status, error.message, error.code));
          setPending(false);
          return;
        }
        if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
          setStep("totp");
          setPending(false);
          return;
        }
      } else {
        const code = String(form.get("code")).replace(/\s/g, "");
        const { error } = step === "totp" ? await authClient.twoFactor.verifyTotp({ code }) : await authClient.twoFactor.verifyBackupCode({ code });
        if (error) {
          setError(
            error.status === 401 || error.status === 400
              ? step === "totp"
                ? "That code is not right. Use the current 6-digit code from your authenticator app."
                : "That recovery code is not right or was already used."
              : messageFor(error.status, error.message, error.code),
          );
          setPending(false);
          return;
        }
      }
      window.location.assign("/"); // full load so every page sees the new session
    } catch {
      setError(messageFor(0));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {step === "password" ? (
        <>
          <div>
            <label htmlFor="email" className="label">
              Email
            </label>
            <input id="email" name="email" type="email" autoComplete="username" required className="input" />
          </div>
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="code" className="label">
            {step === "totp" ? "6-digit code from your authenticator app" : "Recovery code"}
          </label>
          <input
            key={step}
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode={step === "totp" ? "numeric" : "text"}
            pattern={step === "totp" ? "\\s*\\d{3}\\s?\\d{3}\\s*" : undefined}
            maxLength={step === "totp" ? 7 : 20}
            required
            autoFocus
            className="input tracking-widest"
          />
          <button type="button" onClick={() => { setStep(step === "totp" ? "recovery" : "totp"); setError(null); }} className="mt-2 text-sm text-blue-700 underline">
            {step === "totp" ? "Lost your phone? Use a recovery code" : "Use the authenticator app instead"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Signing in…" : step === "password" ? "Sign in" : "Verify"}
      </button>
    </form>
  );
}
