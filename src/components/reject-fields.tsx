"use client";

import { useState } from "react";
import type { CategoryOption, ReasonOption } from "@/lib/rediscovery/categories";

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Optional cost figures (LPA) of a cost decision. `against` labels the second figure. */
export function CostFields({ id, expectedLpa, budgetLpa, against = "Our budget", onChange }: {
  id: string;
  expectedLpa: number | null;
  budgetLpa?: number | null;
  against?: string | null; // null: no second field (a declined offer uses the offered CTC)
  onChange: (v: { expectedLpa: number | null; budgetLpa: number | null }) => void;
}) {
  const [e, setE] = useState(expectedLpa === null ? "" : String(expectedLpa));
  const [b, setB] = useState(budgetLpa === null || budgetLpa === undefined ? "" : String(budgetLpa));
  const push = (ne: string, nb: string) => onChange({ expectedLpa: num(ne), budgetLpa: num(nb) });
  return (
    <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm font-medium text-slate-700">Cost details (optional, HR only)</legend>
      <div>
        <label htmlFor={`${id}-exp`} className="label">Candidate&apos;s expected CTC (LPA)</label>
        <input id={`${id}-exp`} type="number" inputMode="decimal" min={0} max={100} step={0.01} value={e} onChange={(x) => { setE(x.target.value); push(x.target.value, b); }} className="input" />
      </div>
      {against !== null && (
        <div>
          <label htmlFor={`${id}-bud`} className="label">{against} (LPA)</label>
          <input id={`${id}-bud`} type="number" inputMode="decimal" min={0} max={100} step={0.01} value={b} onChange={(x) => { setB(x.target.value); push(e, x.target.value); }} className="input" />
        </div>
      )}
    </fieldset>
  );
}

/** Reject reason picker that shows the reason's category; cost reasons open the cost fields. */
export function RejectReasonFields({ id, reasons, value, onChange, expectedLpa, onCost, name }: {
  id: string;
  reasons: ReasonOption[];
  value: string;
  onChange: (v: string) => void;
  expectedLpa: number | null;
  onCost: (v: { expectedLpa: number | null; budgetLpa: number | null }) => void;
  name?: string;
}) {
  const chosen = reasons.find((r) => r.label === value);
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={id} className="label">Reject reason</label>
        <select id={id} name={name} required value={value} onChange={(e) => onChange(e.target.value)} className="input">
          <option value="">Choose…</option>
          {reasons.map((r) => (
            <option key={r.label} value={r.label}>{r.label}</option>
          ))}
        </select>
        {chosen && <p className="mt-1 text-sm text-slate-600" data-testid="reject-category">Category: {chosen.category}</p>}
      </div>
      {chosen?.isCost && <CostFields key={value} id={`${id}-cost`} expectedLpa={expectedLpa} onChange={onCost} />}
    </div>
  );
}

/** Optional category of a declined offer. */
export function DeclineCategory({ id, categories, value, onChange }: { id: string; categories: CategoryOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="label">Why did they decline? (optional)</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="input">
        <option value="">Not recorded</option>
        {categories.map((c) => (
          <option key={c.code} value={c.code}>{c.label}</option>
        ))}
      </select>
    </div>
  );
}
