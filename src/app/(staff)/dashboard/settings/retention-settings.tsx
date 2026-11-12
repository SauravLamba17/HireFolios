"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { send } from "@/lib/send";

type Props = {
  cooldownDays: number;
  photoRetentionDays: number;
  dataRetentionDays: number;
  preview: { photos: number; candidates: number };
  lastRun: string | null;
};

/** Settings → how long data is kept, with a preview of what the automatic deletion will remove soon. */
export function RetentionSettings({ cooldownDays, photoRetentionDays, dataRetentionDays, preview, lastRun }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const recalc = f.get("recalc") === "on";
    if (recalc && !confirm("Re-calculate the deletion dates of everyone already decided? Shorter periods can make some records due for deletion at the next run.")) return;
    setBusy(true);
    setMsg(null);
    const err = await send("/api/settings/tenant", "PATCH", {
      retention: {
        cooldownDays: Number(f.get("cooldown")),
        photoRetentionDays: Number(f.get("photo")),
        dataRetentionDays: Number(f.get("data")),
        recalculateExisting: recalc,
      },
    });
    setMsg({ ok: !err, text: err ?? (recalc ? "Saved. Existing deletion dates were re-calculated." : "Saved. New periods apply to decisions from now on.") });
    router.refresh();
    setBusy(false);
  }

  return (
    <section className="card space-y-4" aria-labelledby="ret-h">
      <div>
        <h2 id="ret-h" className="text-lg font-semibold">How long data is kept</h2>
        <p className="mt-1 text-sm text-slate-600">
          When a candidate is not hired (rejected, no-show, walked away or offer declined), their photo and then all their data are deleted automatically
          after these periods, counted from the decision. Candidates in the talent pool, candidates who joined, and anyone with a newer visit are never
          deleted. Changes apply to future decisions unless you tick &ldquo;re-calculate&rdquo;. Confirm these periods with your HR team and legal adviser.
        </p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="cooldown" className="label">Cooldown after a rejection (days)</label>
          <input id="cooldown" name="cooldown" type="number" min={0} max={365} step={1} required defaultValue={cooldownDays} className="input" />
          <p className="mt-1 text-xs text-slate-500">HR sees a warning if the candidate walks in again within this time. 0–365.</p>
        </div>
        <div>
          <label htmlFor="photo" className="label">Delete photos after (days)</label>
          <input id="photo" name="photo" type="number" min={30} max={3650} step={1} required defaultValue={photoRetentionDays} className="input" />
          <p className="mt-1 text-xs text-slate-500">30–3650, not more than the next field.</p>
        </div>
        <div>
          <label htmlFor="data" className="label">Delete all other data after (days)</label>
          <input id="data" name="data" type="number" min={30} max={3650} step={1} required defaultValue={dataRetentionDays} className="input" />
          <p className="mt-1 text-xs text-slate-500">30–3650. CVs, details, visits and scorecards.</p>
        </div>
        <label className="flex items-center gap-2 md:col-span-3">
          <input type="checkbox" name="recalc" className="size-5 accent-blue-700" /> Re-calculate the deletion dates of candidates already decided
        </label>
        <div className="md:col-span-3">
          <button type="submit" disabled={busy} className="btn btn-primary">{busy ? "Saving…" : "Save periods"}</button>
        </div>
      </form>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "alert-success" : "alert-error"}>{msg.text}</p>}
      <p className="rounded-lg bg-slate-50 p-3 text-sm" data-testid="purge-preview">
        Automatic deletion in the next 7 days: <strong>{preview.photos}</strong> {preview.photos === 1 ? "photo" : "photos"} and{" "}
        <strong>{preview.candidates}</strong> {preview.candidates === 1 ? "candidate" : "candidates"}.{" "}
        <span className="text-slate-600">The job runs every 30 minutes{lastRun ? `; last run ${lastRun}` : ""}.</span>
      </p>
    </section>
  );
}
