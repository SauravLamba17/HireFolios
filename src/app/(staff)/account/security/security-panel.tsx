"use client";

// Two-factor sign-in with any free authenticator app (Google Authenticator, Microsoft Authenticator, Authy…): scan the
// QR code (made in the browser, nothing leaves the office), type one code to confirm, keep the recovery codes.
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

type Step = { kind: "idle" } | { kind: "scan"; uri: string; qr: string; codes: string[] } | { kind: "codes"; codes: string[] };

const secretOf = (uri: string) => new URL(uri).searchParams.get("secret") ?? "";

export function SecurityPanel({ enabled, required, next }: { enabled: boolean; required: boolean; next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const done = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setBusy(false);
  };

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setBusy(true);
    setMsg(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data || !("totpURI" in data)) return done(false, error?.status === 400 || error?.status === 401 ? "Wrong password." : (error?.message ?? "Could not start. Try again."));
    const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 });
    setStep({ kind: "scan", uri: data.totpURI, qr, codes: data.backupCodes });
    setBusy(false);
  }

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "scan") return;
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    setBusy(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return done(false, "That code is not right. Type the current 6-digit code from the app.");
    setStep({ kind: "codes", codes: step.codes });
    done(true, "Two-factor sign-in is on.");
  }

  async function disable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setBusy(true);
    const { error } = await authClient.twoFactor.disable({ password });
    if (error) return done(false, "Wrong password.");
    done(true, "Two-factor sign-in is off.");
    router.refresh();
  }

  async function newCodes(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setBusy(true);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
    if (error || !data) return done(false, "Wrong password.");
    setStep({ kind: "codes", codes: data.backupCodes });
    done(true, "New recovery codes made. The old ones no longer work.");
  }

  async function everywhere() {
    if (!window.confirm("Sign out on every computer and phone, including this one?")) return;
    setBusy(true);
    await authClient.revokeSessions().catch(() => {});
    window.location.assign("/login");
  }

  const box = msg && (
    <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "alert-success" : "alert-error"}>
      {msg.text}
    </p>
  );
  const passwordField = (id: string) => (
    <div>
      <label htmlFor={id} className="label">Your password</label>
      <input id={id} name="password" type="password" autoComplete="current-password" required className="input" />
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="card space-y-4" aria-labelledby="tf-h">
        <h2 id="tf-h" className="text-lg font-semibold">
          Two-factor sign-in: <span className={enabled || step.kind === "codes" ? "text-green-800" : "text-slate-700"}>{enabled || step.kind === "codes" ? "on" : "off"}</span>
        </h2>
        <p className="text-sm text-slate-600">
          After your password, sign-in asks for a 6-digit code from an authenticator app on your phone. Someone who learns your password still cannot sign in.
        </p>

        {step.kind === "codes" && (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="recovery-codes">
            <p className="font-semibold text-amber-950">Recovery codes: write them down or print them now. Each works once if you lose your phone.</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-base">
              {step.codes.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <button type="button" onClick={() => window.location.assign(next)} className="btn btn-primary">I have saved them — continue</button>
          </div>
        )}

        {step.kind === "scan" && (
          <form onSubmit={confirm} className="space-y-3" aria-label="Confirm the authenticator app">
            <p>1. In the authenticator app, add an account and scan this code (or type the key below).</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- QR made in the browser as a data URL */}
            <img src={step.qr} alt="QR code for the authenticator app" width={220} height={220} className="rounded border border-slate-200" />
            <p className="text-sm">
              Key: <code className="font-mono break-all" data-testid="totp-secret">{secretOf(step.uri)}</code>
            </p>
            <div>
              <label htmlFor="tf-code" className="label">2. The 6-digit code the app shows</label>
              <input id="tf-code" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} className="input w-40 tracking-widest" />
            </div>
            <button type="submit" disabled={busy} className="btn btn-primary">Turn on</button>
          </form>
        )}

        {step.kind === "idle" && !enabled && (
          <form onSubmit={start} className="space-y-3" aria-label="Set up two-factor sign-in">
            {passwordField("tf-pw")}
            <button type="submit" disabled={busy} className="btn btn-primary">Set up two-factor sign-in</button>
          </form>
        )}

        {enabled && step.kind === "idle" && (
          <div className="grid gap-4 md:grid-cols-2">
            <form onSubmit={newCodes} className="space-y-3" aria-label="New recovery codes">
              {passwordField("tf-codes-pw")}
              <button type="submit" disabled={busy} className="btn btn-secondary">New recovery codes</button>
            </form>
            {!required && (
              <form onSubmit={disable} className="space-y-3" aria-label="Turn off two-factor sign-in">
                {passwordField("tf-off-pw")}
                <button type="submit" disabled={busy} className="btn btn-danger">Turn off</button>
              </form>
            )}
          </div>
        )}
        {required && enabled && <p className="text-sm text-slate-600">Your role must use two-factor sign-in, so it cannot be turned off here. Lost your phone? Use a recovery code, or ask an admin to reset it.</p>}
        {box}
      </section>

      <section className="card space-y-3" aria-labelledby="ev-h">
        <h2 id="ev-h" className="text-lg font-semibold">Sign out everywhere</h2>
        <p className="text-sm text-slate-600">Ends your sessions on every computer, including any you forgot to sign out of. Changing your password does this too.</p>
        <button type="button" onClick={everywhere} disabled={busy} className="btn btn-secondary">Sign out everywhere</button>
      </section>
    </div>
  );
}
