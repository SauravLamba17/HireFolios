"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RejectReasonFields } from "@/components/reject-fields";
import type { ReasonOption } from "@/lib/rediscovery/categories";
import { send } from "@/lib/send";

export function StatusToggle({ status }: { status: "available" | "away" | "busy" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (status === "busy") return null;
  const next = status === "available" ? "away" : "available";
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        className={`btn ${status === "available" ? "btn-secondary" : "btn-primary"}`}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setError(await send("/api/interview", "POST", { action: "status", status: next }));
          router.refresh();
          setBusy(false);
        }}
      >
        {status === "available" ? "Step away" : "I'm available"}
      </button>
      {error && <p role="alert" className="alert-error mt-2">{error}</p>}
    </div>
  );
}

type Criterion = { label: string; required: boolean };

export function InterviewForm({ applicationId, token, criteria, reasons, expectedLpa }: { applicationId: string; token: string; criteria: Criterion[]; reasons: ReasonOption[]; expectedLpa: number | null }) {
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [decision, setDecision] = useState<"pass" | "hold" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [cost, setCost] = useState<{ expectedLpa: number | null; budgetLpa: number | null }>({ expectedLpa, budgetLpa: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = criteria.filter((c) => c.required && !scores[c.label]).map((c) => c.label);

  async function submit() {
    setError(null);
    if (missing.length) return setError(`Rate the required criteria: ${missing.join(", ")}.`);
    if (!decision) return setError("Choose Pass, Hold or Reject.");
    if (decision === "reject" && !reason) return setError("Choose a reject reason.");
    setBusy(true);
    const err = await send("/api/interview", "POST", { action: "decide", applicationId, scores, notes, decision,
      rejectReason: decision === "reject" ? reason : null,
      ...(decision === "reject" && reasons.find((r) => r.label === reason)?.isCost ? { costExpectedLpa: cost.expectedLpa, costBudgetLpa: cost.budgetLpa } : {}),
    });
    setBusy(false);
    if (err) return setError(err);
    router.refresh(); // panel is free again; the next candidate appears when HR assigns one
  }

  return (
    <section className="card space-y-5" aria-labelledby="score-h">
      <h2 id="score-h" className="text-lg font-semibold">Your scorecard for {token}</h2>
      {criteria.length === 0 && <p className="text-slate-600">No criteria are set for this round (Settings → Stages).</p>}
      {criteria.map((c) => (
        <div key={c.label}>
          <p id={`crit-${c.label}`} className="label">
            {c.label}
            {c.required && <span className="text-red-700"> *</span>}
          </p>
          <div role="radiogroup" aria-labelledby={`crit-${c.label}`} className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={scores[c.label] === n}
                aria-label={`${c.label}: ${n}`}
                onClick={() => setScores((s) => ({ ...s, [c.label]: n }))}
                className={`h-12 w-12 rounded-lg border text-lg font-semibold ${scores[c.label] === n ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div>
        <label htmlFor="notes" className="label">Notes (optional)</label>
        <textarea id="notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className="input h-auto py-2" />
      </div>
      <div>
        <p id="decision-l" className="label">Decision</p>
        <div role="radiogroup" aria-labelledby="decision-l" className="grid grid-cols-3 gap-2">
          {(
            [
              ["pass", "Pass", "border-green-700 bg-green-700"],
              ["hold", "Hold", "border-amber-600 bg-amber-600"],
              ["reject", "Reject", "border-red-700 bg-red-700"],
            ] as const
          ).map(([v, label, on]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={decision === v}
              onClick={() => setDecision(v)}
              className={`h-14 rounded-lg border text-lg font-semibold ${decision === v ? `${on} text-white` : "border-slate-300 bg-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {decision === "reject" && (
        <RejectReasonFields id="reason" reasons={reasons} value={reason} onChange={setReason} expectedLpa={expectedLpa} onCost={setCost} />
      )}
      {error && <p role="alert" className="alert-error">{error}</p>}
      <button type="button" disabled={busy} onClick={submit} className="btn btn-primary h-14 w-full text-lg">
        {busy ? "Saving…" : "Submit and free the panel"}
      </button>
    </section>
  );
}
