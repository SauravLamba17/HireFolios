"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { OFFER_STATUS_LABELS, OUTCOME_LABELS } from "@/lib/options";
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

/** Correction request: fix the candidate's core details (same rules as intake). */
export function CorrectDetails({ candidateId, value }: { candidateId: string; value: { fullName: string; mobile: string; email: string | null; city: string | null; dateOfBirth: string | null } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg(null);
    const err = await send(`/api/candidates/${candidateId}`, "PATCH", {
      fullName: f.get("fullName"),
      mobile: f.get("mobile"),
      email: String(f.get("email") ?? ""),
      city: f.get("city"),
      dateOfBirth: f.get("dob"),
    });
    setMsg({ ok: !err, text: err ?? "Details corrected." });
    router.refresh();
    setBusy(false);
  }
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">Correct details</summary>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 md:grid-cols-3">
        {(
          [
            ["fullName", "Full name", value.fullName, "text"],
            ["mobile", "Mobile", value.mobile, "tel"],
            ["email", "Email (optional)", value.email ?? "", "email"],
            ["city", "City", value.city ?? "", "text"],
            ["dob", "Date of birth", value.dateOfBirth ?? "", "date"],
          ] as const
        ).map(([name, label, v, type]) => (
          <div key={name}>
            <label htmlFor={`fix-${name}`} className="label">{label}</label>
            <input id={`fix-${name}`} name={name} type={type} defaultValue={v} required={name !== "email"} className="input" />
          </div>
        ))}
        <div className="md:col-span-3">
          <button type="submit" disabled={busy} className="btn btn-primary">Save corrections</button>
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`md:col-span-3 ${msg.ok ? "alert-success" : "alert-error"}`}>{msg.text}</p>}
      </form>
    </details>
  );
}

/** After Selected: record the offer (CTC in LPA, joining date, status) and mark the candidate joined. */
export function OfferForm({
  applicationId,
  offer,
  canJoin,
  today,
}: {
  applicationId: string;
  offer: { status: string | null; offeredCtcLpa: number | null; joiningDate: string | null };
  canJoin: boolean;
  today: string;
}) {
  const { busy, post, box } = useSend(applicationId);
  async function onOffer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ctc = String(f.get("ctc") ?? "").trim();
    await post(
      { action: "offer", status: f.get("status"), offeredCtcLpa: ctc === "" ? null : Number(ctc), joiningDate: String(f.get("joining") || "") || null },
      "Offer saved.",
    );
  }
  async function onJoined(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = String(new FormData(e.currentTarget).get("joinedOn"));
    if (!confirm("Mark this candidate as joined? Their data is then kept as an employee record (never auto-deleted).")) return;
    await post({ action: "joined", joinedOn: d }, "Marked as joined.");
  }
  return (
    <section className="space-y-4 rounded-lg border border-green-200 bg-green-50/50 p-4" aria-label="Offer and joining">
      <h4 className="font-semibold text-green-950">Offer and joining</h4>
      <form onSubmit={onOffer} className="grid gap-3 md:grid-cols-4 md:items-end">
        <div>
          <label htmlFor="offer-status" className="label">Offer status</label>
          <select id="offer-status" name="status" required defaultValue={offer.status ?? "offered"} className="input">
            {Object.entries(OFFER_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="offer-ctc" className="label">Offered CTC (LPA)</label>
          <input id="offer-ctc" name="ctc" type="number" inputMode="decimal" min={0} max={100} step={0.01} defaultValue={offer.offeredCtcLpa ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="offer-joining" className="label">Joining date</label>
          <input id="offer-joining" name="joining" type="date" defaultValue={offer.joiningDate ?? ""} className="input" />
        </div>
        <button type="submit" disabled={busy} className="btn btn-secondary">Save offer</button>
      </form>
      {canJoin && (
        <form onSubmit={onJoined} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="joined-on" className="label">Joined on</label>
            <input id="joined-on" name="joinedOn" type="date" required max={today} defaultValue={offer.joiningDate && offer.joiningDate <= today ? offer.joiningDate : today} className="input" />
          </div>
          <button type="submit" disabled={busy} className="btn btn-primary">Mark joined</button>
        </form>
      )}
      {box}
    </section>
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
