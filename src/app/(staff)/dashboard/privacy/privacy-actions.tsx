"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { send } from "@/lib/send";

function usePost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function post(body: unknown, success: string) {
    setBusy(true);
    setMsg(null);
    const err = await send("/api/privacy", "POST", body);
    setMsg({ ok: !err, text: err ?? success });
    router.refresh();
    setBusy(false);
    return !err;
  }
  const box = msg && (
    <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "alert-success" : "alert-error"}>
      {msg.text}
    </p>
  );
  return { busy, post, box };
}

export const KINDS = { access: "Access (a copy of their data)", correction: "Correction", erasure: "Erasure (delete their data)", grievance: "Grievance" } as const;

export function NewRequest({ today }: { today: string }) {
  const { busy, post, box } = usePost();
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await post(
      {
        action: "create",
        kind: f.get("kind"),
        mobile: String(f.get("mobile") ?? "").trim() || null,
        requesterName: String(f.get("who")),
        requesterContact: String(f.get("contact") ?? ""),
        receivedOn: String(f.get("received")),
        notes: String(f.get("notes") ?? ""),
      },
      "Request logged. It must be answered within 90 days.",
    );
    if (ok) form.reset();
  }
  return (
    <form onSubmit={onSubmit} className="card grid gap-4 md:grid-cols-3" aria-label="Log a request">
      <h2 className="text-lg font-semibold md:col-span-3">Log a request</h2>
      <div>
        <label htmlFor="kind" className="label">Kind</label>
        <select id="kind" name="kind" required defaultValue="" className="input">
          <option value="" disabled>Choose…</option>
          {Object.entries(KINDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="who" className="label">Who asked</label>
        <input id="who" name="who" required minLength={2} maxLength={100} className="input" />
      </div>
      <div>
        <label htmlFor="received" className="label">Received on</label>
        <input id="received" name="received" type="date" required max={today} defaultValue={today} className="input" />
      </div>
      <div>
        <label htmlFor="mobile" className="label">Candidate&apos;s mobile (to link their record)</label>
        <input id="mobile" name="mobile" type="tel" inputMode="tel" maxLength={20} className="input" />
      </div>
      <div className="md:col-span-2">
        <label htmlFor="contact" className="label">How to reply (email / phone / address)</label>
        <input id="contact" name="contact" maxLength={200} className="input" />
      </div>
      <div className="md:col-span-3">
        <label htmlFor="notes" className="label">What they asked (optional)</label>
        <textarea id="notes" name="notes" rows={2} maxLength={2000} className="input h-auto py-2" />
      </div>
      <div className="md:col-span-3">
        <button type="submit" disabled={busy} className="btn btn-primary">Log request</button>
      </div>
      <div className="md:col-span-3">{box}</div>
    </form>
  );
}

export function RequestActions({ id, kind, status, resolution, hasCandidate }: { id: string; kind: string; status: string; resolution: string | null; hasCandidate: boolean }) {
  const { busy, post, box } = usePost();
  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void post({ action: "update", id, status: f.get("status"), resolution: String(f.get("resolution") ?? "") }, "Saved.");
        }}
      >
        <label className="sr-only" htmlFor={`st-${id}`}>Status</label>
        <select key={status} id={`st-${id}`} name="status" defaultValue={status} className="input h-10 w-auto">
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
        </select>
        <label className="sr-only" htmlFor={`res-${id}`}>Resolution</label>
        <input key={resolution ?? ""} id={`res-${id}`} name="resolution" defaultValue={resolution ?? ""} maxLength={2000} placeholder="Resolution note" className="input h-10 min-w-48 flex-1" />
        <button type="submit" disabled={busy} className="btn btn-secondary h-10">Save</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {kind === "access" && hasCandidate && (
          <a href={`/api/privacy/${id}/export`} className="btn btn-secondary h-10">Download their data (ZIP)</a>
        )}
        {kind === "erasure" && hasCandidate && status !== "completed" && (
          <button
            type="button"
            disabled={busy}
            className="btn btn-danger h-10"
            onClick={() => {
              const typed = prompt('This permanently deletes the candidate, all visits, scorecards, consents, photos and CV files. It cannot be undone.\n\nType ERASE to continue.');
              if (typed?.trim().toUpperCase() !== "ERASE") return;
              void post({ action: "erase", id }, "Erased. The request is marked completed.");
            }}
          >
            Erase now
          </button>
        )}
      </div>
      {box}
    </div>
  );
}
