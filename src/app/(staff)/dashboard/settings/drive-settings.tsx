"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { send } from "@/lib/send";

type Criterion = { label: string; required: boolean };
export type StageRow = { id: string; name: string; active: boolean; isInterview: boolean; criteria: Criterion[]; sample: boolean };
export type ReasonRow = { id: string; label: string; active: boolean; sample: boolean; categoryCode: string | null };
type CategoryChoice = { code: string; label: string; active: boolean };

function usePost() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function post(url: string, method: "POST" | "PATCH", body: unknown, success: string) {
    setBusy(true);
    setMsg(null);
    const err = await send(url, method, body);
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

const SampleBadge = () => <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-900">Sample — check and save</span>;

function StageCard({ s, first, last }: { s: StageRow; first: boolean; last: boolean }) {
  const { busy, post, box } = usePost();
  const [name, setName] = useState(s.name);
  const [active, setActive] = useState(s.active);
  const [isInterview, setIsInterview] = useState(s.isInterview);
  const [criteria, setCriteria] = useState<Criterion[]>(s.criteria);
  const setC = (i: number, patch: Partial<Criterion>) => setCriteria((c) => c.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <article className="card space-y-3 p-4" aria-label={`Stage ${s.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-semibold">{s.name}</h4>
        {!s.active && <span className="rounded-full bg-slate-200 px-2.5 py-1 text-sm">Inactive</span>}
        {s.isInterview && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-sm text-blue-800">Interview round</span>}
        {s.sample && <SampleBadge />}
        <span className="ml-auto flex gap-1">
          <button type="button" aria-label={`Move ${s.name} up`} disabled={busy || first} onClick={() => post("/api/settings/stages", "POST", { action: "move", stageId: s.id, direction: "up" }, "Moved up.")} className="btn btn-secondary h-10 px-3">
            ↑
          </button>
          <button type="button" aria-label={`Move ${s.name} down`} disabled={busy || last} onClick={() => post("/api/settings/stages", "POST", { action: "move", stageId: s.id, direction: "down" }, "Moved down.")} className="btn btn-secondary h-10 px-3">
            ↓
          </button>
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor={`sn-${s.id}`} className="label">Stage name</label>
          <input id={`sn-${s.id}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="input" />
        </div>
        <label className="flex h-12 items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-blue-700" /> Active
        </label>
        <label className="flex h-12 items-center gap-2">
          <input type="checkbox" checked={isInterview} onChange={(e) => setIsInterview(e.target.checked)} className="size-5 accent-blue-700" /> Interview round
        </label>
      </div>
      {isInterview && (
        <fieldset className="space-y-2">
          <legend className="label">Scorecard criteria (each rated 1–5)</legend>
          {criteria.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`cr-${s.id}-${i}`}>Criterion {i + 1}</label>
              <input id={`cr-${s.id}-${i}`} value={c.label} onChange={(e) => setC(i, { label: e.target.value })} maxLength={60} className="input min-w-0 flex-1" />
              <label className="flex h-12 items-center gap-2 text-sm">
                <input type="checkbox" checked={c.required} onChange={(e) => setC(i, { required: e.target.checked })} className="size-5 accent-blue-700" /> Required
              </label>
              <button type="button" onClick={() => setCriteria((x) => x.filter((_, j) => j !== i))} className="btn btn-danger h-10 px-3 text-sm">
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setCriteria((x) => [...x, { label: "", required: false }])} className="btn btn-secondary h-10 text-sm">
            + Add criterion
          </button>
        </fieldset>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => post("/api/settings/stages", "POST", { action: "update", stageId: s.id, name, active, isInterview, criteria }, `Saved ${name}.`)}
        className="btn btn-primary"
      >
        {s.sample ? "Save and confirm" : "Save"}
      </button>
      {box}
    </article>
  );
}

function ReasonRowEdit({ r, categories }: { r: ReasonRow; categories: CategoryChoice[] }) {
  const { busy, post, box } = usePost();
  const [label, setLabel] = useState(r.label);
  const [active, setActive] = useState(r.active);
  const [categoryCode, setCategoryCode] = useState(r.categoryCode ?? "other");
  return (
    <li className="space-y-2 border-b border-slate-100 pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`rr-${r.id}`}>Reason</label>
        <input id={`rr-${r.id}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} className="input min-w-0 flex-1" />
        <label className="sr-only" htmlFor={`rc-${r.id}`}>Category of {r.label}</label>
        <select id={`rc-${r.id}`} value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)} className="input w-auto max-w-72">
          {categories.filter((c) => c.active || c.code === categoryCode).map((c) => (
            <option key={c.code} value={c.code}>{c.label}{c.active ? "" : " (retired)"}</option>
          ))}
        </select>
        <label className="flex h-12 items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-5 accent-blue-700" /> In use
        </label>
        <button type="button" disabled={busy} onClick={() => post("/api/settings/reasons", "POST", { action: "update", reasonId: r.id, label, active, categoryCode }, "Saved.")} className="btn btn-secondary">
          Save
        </button>
        {r.sample && <SampleBadge />}
      </div>
      {box}
    </li>
  );
}

export function DriveSettings({ stages, reasons, categories, avgMinutes }: { stages: StageRow[]; reasons: ReasonRow[]; categories: CategoryChoice[]; avgMinutes: number | null }) {
  const addStage = usePost();
  const addReason = usePost();
  const avg = usePost();
  const sampleStages = stages.filter((s) => s.sample).length;

  async function onAdd(e: FormEvent<HTMLFormElement>, kind: "stage" | "reason") {
    e.preventDefault();
    const form = e.currentTarget;
    const v = String(new FormData(form).get("v")).trim();
    const ok =
      kind === "stage"
        ? await addStage.post("/api/settings/stages", "POST", { action: "create", name: v }, `Added ${v} at the end. Tick "Interview round" if panels will handle it.`)
        : await addReason.post("/api/settings/reasons", "POST", { action: "create", label: v }, `Added ${v}.`);
    if (ok) form.reset();
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="stages-h">
        <div>
          <h2 id="stages-h" className="text-lg font-semibold">Stages and interview rounds</h2>
          <p className="mt-1 text-sm text-slate-600">
            Candidates go through the active stages top to bottom. Panels on the drive board handle interview rounds; passing the last interview round makes the candidate Selected.
            {sampleStages > 0 && ` ${sampleStages} stages are sample data: confirm the real rounds with your HR team, then save each one.`}
          </p>
        </div>
        {stages.map((s, i) => (
          <StageCard key={JSON.stringify(s)} s={s} first={i === 0} last={i === stages.length - 1} />
        ))}
        <form onSubmit={(e) => onAdd(e, "stage")} className="card flex flex-wrap items-end gap-3 p-4" aria-label="Add a stage">
          <div className="min-w-64 flex-1">
            <label htmlFor="new-stage" className="label">New stage</label>
            <input id="new-stage" name="v" required minLength={2} maxLength={60} className="input" />
          </div>
          <button type="submit" disabled={addStage.busy} className="btn btn-primary">Add stage</button>
          <div className="w-full">{addStage.box}</div>
        </form>
      </section>

      <section className="card space-y-4" aria-labelledby="reasons-h">
        <div>
          <h2 id="reasons-h" className="text-lg font-semibold">Reject reasons</h2>
          <p className="mt-1 text-sm text-slate-600">Interviewers pick one when they reject. Each reason belongs to a category (Settings → Lists → Reject categories), shown next to the reason and used to find strong people turned away for cost, timing, shift or a filled seat. Untick &ldquo;In use&rdquo; to retire a reason; past rejections keep their text.</p>
        </div>
        <ul className="space-y-3">
          {reasons.map((r) => (
            <ReasonRowEdit key={JSON.stringify(r)} r={r} categories={categories} />
          ))}
        </ul>
        <form onSubmit={(e) => onAdd(e, "reason")} className="flex flex-wrap items-end gap-3" aria-label="Add a reject reason">
          <div className="min-w-64 flex-1">
            <label htmlFor="new-reason" className="label">New reason</label>
            <input id="new-reason" name="v" required minLength={2} maxLength={100} className="input" />
          </div>
          <button type="submit" disabled={addReason.busy} className="btn btn-primary">Add reason</button>
          <div className="w-full">{addReason.box}</div>
        </form>
      </section>

      <section className="card space-y-3" aria-labelledby="avg-h">
        <h2 id="avg-h" className="text-lg font-semibold">Average interview time</h2>
        <p className="text-sm text-slate-600">
          Used for waiting-time estimates only until 3 interviews finish on the day; after that the board uses the day&apos;s real times. Leave empty to show no
          estimate before then.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("avg")).trim();
            avg.post("/api/settings/tenant", "PATCH", { avgInterviewMinutes: v === "" ? null : Number(v) }, v === "" ? "Cleared." : `Saved: ${v} minutes.`);
          }}
        >
          <div>
            <label htmlFor="avg" className="label">Minutes per interview</label>
            <input id="avg" name="avg" type="number" inputMode="numeric" min={1} max={240} step={1} defaultValue={avgMinutes ?? ""} className="input w-40" />
          </div>
          <button type="submit" disabled={avg.busy} className="btn btn-primary">Save</button>
        </form>
        {avg.box}
      </section>
    </div>
  );
}
