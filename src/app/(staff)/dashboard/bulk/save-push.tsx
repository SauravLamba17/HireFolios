"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/** Saves the current bulk list as a named hiring push (the server rebuilds the list from these criteria). */
export function SavePush({ criteria, suggestedName, count }: { criteria: Record<string, unknown>; suggestedName: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pushes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, criteria }) });
      const j = (await res.json().catch(() => null)) as { result?: { id: string }; error?: string } | null;
      if (!res.ok || !j?.result) return setError(j?.error ?? "Could not save the push.");
      router.push(`/dashboard/pushes/${j.result.id}`);
    } catch {
      setError("Could not reach the server. Check the connection.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="card flex flex-wrap items-end gap-3" aria-label="Save as a hiring push">
      <div className="min-w-64 flex-1">
        <label htmlFor="push-name" className="label">Save this list as a hiring push ({Math.min(count, 200)} people)</label>
        <input id="push-name" name="name" required minLength={3} maxLength={100} defaultValue={suggestedName} className="input" />
      </div>
      <button type="submit" disabled={busy} className="btn btn-primary">Save push</button>
      {error && <p role="alert" className="alert-error w-full">{error}</p>}
    </form>
  );
}
