"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

function messageFor(status: number, message?: string, code?: string) {
  if (status === 401) return "Wrong email or password.";
  if (code === "INVALID_ORIGIN") return "Sign-in is not allowed from this address. Ask your admin.";
  if (status === 403) return message || "This account is deactivated.";
  if (status === 429) return "Too many attempts. Wait a minute and try again.";
  return "Could not sign in. Check the connection and try again.";
}

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { error } = await authClient.signIn.email({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
      });
      if (error) {
        setError(messageFor(error.status, error.message, error.code));
        setPending(false);
        return;
      }
      window.location.assign("/"); // full load so every page sees the new session
    } catch {
      setError(messageFor(0));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>
      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
