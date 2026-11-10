"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { OUTCOME_LABELS } from "@/lib/options";
import { send } from "@/lib/send";

function useSend(applicationId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function post(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setMsg(null);
    const err = await send(`/api/applications/${applicationId}`, "POST", body);
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

export function ResumeButton({ applicationId }: { applicationId: string }) {
  const { busy, post, box } = useSend(applicationId);
  return (
    <div className="space-y-2">
      <button type="button" disabled={busy} onClick={() => post({ action: "resume" }, "Back in today's queue.")} className="btn btn-primary">
        Resume: put back in today&apos;s queue
      </button>
      {box}
    </div>
  );
}

/** Manager / admin: move to any stage, or set any outcome, with a mandatory reason (audited). */
export function OverrideForm({ applicationId, stages, reasons }: { applicationId: string; stages: { id: string; name: string }[]; reasons: string[] }) {
  const { busy, post, box } = useSend(applicationId);
  const [outcome, setOutcome] = useState("");

  async function onStage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (await post({ action: "moveStage", stageId: f.get("stageId"), reason: f.get("reason") }, "Moved. The candidate is waiting on today's board.")) form.reset();
  }
  async function onOutcome(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const ok = await post(
      { action: "setOutcome", outcome, rejectReason: outcome === "rejected" ? f.get("rejectReason") || null : null, reason: f.get("reason") },
      "Outcome changed.",
    );
    if (ok) {
      form.reset();
      setOutcome("");
    }
  }

  return (
    <details className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <summary className="cursor-pointer font-semibold text-amber-950">Manager override</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <form onSubmit={onStage} className="space-y-2" aria-label="Move to a stage">
          <label htmlFor="ov-stage" className="label">Move to stage</label>
          <select id="ov-stage" name="stageId" required defaultValue="" className="input">
            <option value="" disabled>Choose…</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label htmlFor="ov-stage-reason" className="label">Reason</label>
          <input id="ov-stage-reason" name="reason" required minLength={3} maxLength={500} className="input" />
          <button type="submit" disabled={busy} className="btn btn-secondary">Move</button>
        </form>
        <form onSubmit={onOutcome} className="space-y-2" aria-label="Change the outcome">
          <label htmlFor="ov-outcome" className="label">Set outcome</label>
          <select id="ov-outcome" required value={outcome} onChange={(e) => setOutcome(e.target.value)} className="input">
            <option value="" disabled>Choose…</option>
            {Object.entries(OUTCOME_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {outcome === "rejected" && (
            <>
              <label htmlFor="ov-reject" className="label">Reject reason</label>
              <select id="ov-reject" name="rejectReason" required defaultValue="" className="input">
                <option value="" disabled>Choose…</option>
                {reasons.map((r) => <option key={r}>{r}</option>)}
              </select>
            </>
          )}
          <label htmlFor="ov-outcome-reason" className="label">Reason</label>
          <input id="ov-outcome-reason" name="reason" required minLength={3} maxLength={500} className="input" />
          <button type="submit" disabled={busy} className="btn btn-secondary">Change outcome</button>
        </form>
      </div>
      <div className="mt-3">{box}</div>
    </details>
  );
}
