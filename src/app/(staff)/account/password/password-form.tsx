"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

// forced: temporary password; on success go on to the role's home page (full load, new session cookie).
export function PasswordForm({ forced, next }: { forced: boolean; next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    const newPassword = String(f.get("newPassword"));
    setError(null);
    setDone(false);
    if (newPassword !== f.get("confirm")) return setError("The new passwords do not match.");
    if (newPassword === f.get("currentPassword")) return setError("Choose a password different from the current one.");
    setPending(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword: String(f.get("currentPassword")),
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        setError(
          error.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : error.code === "INVALID_PASSWORD"
              ? forced
                ? "Temporary password is wrong."
                : "Current password is wrong."
              : error.message || "Could not change the password.",
        );
      } else if (forced) {
        window.location.assign(next);
        return;
      } else {
        setDone(true);
        formEl.reset();
      }
    } catch {
      setError("Could not reach the server. Check the connection.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="currentPassword" className="label">{forced ? "Temporary password" : "Current password"}</label>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className="input" />
      </div>
      <div>
        <label htmlFor="newPassword" className="label">New password</label>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className="input" />
        <p className="mt-1.5 text-sm text-slate-500">At least 8 characters.</p>
      </div>
      <div>
        <label htmlFor="confirm" className="label">Repeat new password</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className="input" />
      </div>
      {error && <p role="alert" className="alert-error">{error}</p>}
      {done && <p role="status" className="alert-success">Password changed. Other devices were signed out.</p>}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
