"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Chips } from "@/components/chips";
import { CERTIFICATIONS } from "@/lib/options";
import { send } from "@/lib/send";

type Status = "open" | "paused" | "closed";
export type JobRow = {
  id: string;
  title: string;
  status: Status;
  openings: number | null;
  minExperienceYears: number | null;
  maxExperienceYears: number | null;
  requiredCertifications: string[];
  sample: boolean;
};
type Location = { id: string; name: string };

const STATUS: { value: Status; label: string; short: string; badge: string }[] = [
  { value: "open", label: "Open (offered at intake)", short: "Open", badge: "bg-green-50 text-green-800" },
  { value: "paused", label: "Paused", short: "Paused", badge: "bg-amber-50 text-amber-900" },
  { value: "closed", label: "Closed", short: "Closed", badge: "bg-slate-200 text-slate-700" },
];

const num = (v: FormDataEntryValue | null) => (String(v ?? "").trim() === "" ? null : Number(v));

function JobForm({ job, onSave, busy, submitLabel }: { job?: JobRow; onSave: (body: unknown) => Promise<boolean>; busy: boolean; submitLabel: string }) {
  const [certs, setCerts] = useState<string[]>(job?.requiredCertifications ?? []);
  const p = job?.id ?? "new";

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    const ok = await onSave({
      title: String(f.get("title")).trim(),
      status: f.get("status"),
      openings: num(f.get("openings")),
      minExperienceYears: num(f.get("min")),
      maxExperienceYears: num(f.get("max")),
      requiredCertifications: certs,
    });
    if (ok && !job) {
      formEl.reset();
      setCerts([]);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 md:grid-cols-6">
      <div className="md:col-span-4">
        <label htmlFor={`${p}-title`} className="label">Job title</label>
        <input id={`${p}-title`} name="title" required minLength={2} maxLength={100} defaultValue={job?.title} className="input" />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`${p}-status`} className="label">Status</label>
        <select id={`${p}-status`} name="status" defaultValue={job?.status ?? "open"} className="input">
          {STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`${p}-openings`} className="label">Openings</label>
        <input id={`${p}-openings`} name="openings" type="number" inputMode="numeric" min={0} max={1000} step={1} defaultValue={job?.openings ?? ""} className="input" />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`${p}-min`} className="label">Min experience (years)</label>
        <input id={`${p}-min`} name="min" type="number" inputMode="numeric" min={0} max={45} step={1} defaultValue={job?.minExperienceYears ?? ""} className="input" />
      </div>
      <div className="md:col-span-2">
        <label htmlFor={`${p}-max`} className="label">Max experience (years)</label>
        <input id={`${p}-max`} name="max" type="number" inputMode="numeric" min={0} max={45} step={1} defaultValue={job?.maxExperienceYears ?? ""} className="input" />
      </div>
      <div className="md:col-span-6">
        <span className="label">Required certifications</span>
        <Chips label={`Required certifications for ${job?.title ?? "the new job"}`} options={CERTIFICATIONS} value={certs} onChange={setCerts} disabled={busy} />
      </div>
      <div className="md:col-span-6">
        <button type="submit" disabled={busy} className="btn btn-primary">{busy ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}

export function SettingsManager({ jobs, locations }: { jobs: JobRow[]; locations: Location[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const samples = jobs.filter((j) => j.sample).length;

  // Result next to the job that was saved (no jump to the top of a long list); everything else at the top.
  const [jobMsg, setJobMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  async function run(fn: () => Promise<string | null>, success: string, jobId?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setJobMsg(null);
    const err = await fn();
    if (jobId) setJobMsg({ id: jobId, ok: !err, text: err ?? success });
    else if (err) setError(err);
    else setNotice(success);
    router.refresh();
    setBusy(false);
    if (!jobId) window.scrollTo({ top: 0, behavior: "smooth" });
    return !err;
  }

  async function onRename(e: FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name")).trim();
    await run(() => send(`/api/settings/locations/${id}`, "PATCH", { name }), `Location renamed to ${name}.`);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-slate-600">Company location and the positions offered at intake. Every change is recorded in the audit log.</p>
      </div>

      {error && <p role="alert" className="alert-error">{error}</p>}
      {notice && <p role="status" className="alert-success">{notice}</p>}

      <section className="card space-y-4" aria-labelledby="loc-h">
        <h2 id="loc-h" className="text-lg font-semibold">Company location</h2>
        {locations.map((l) => (
          <form key={l.id} onSubmit={(e) => onRename(e, l.id)} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label htmlFor={`loc-${l.id}`} className="label">Location name</label>
              <input id={`loc-${l.id}`} name="name" required minLength={2} maxLength={100} defaultValue={l.name} className="input" />
            </div>
            <button type="submit" disabled={busy} className="btn btn-primary">Save name</button>
          </form>
        ))}
        {locations.length === 0 && <p className="text-slate-600">No location yet. Run the setup (seed) to create one.</p>}
      </section>

      <section className="card space-y-4" aria-labelledby="add-job-h">
        <h2 id="add-job-h" className="text-lg font-semibold">Add a job</h2>
        <JobForm busy={busy} submitLabel="Add job" onSave={(body) => run(() => send("/api/settings/jobs", "POST", body), "Job added.")} />
      </section>

      <section className="space-y-4" aria-labelledby="jobs-h">
        <div>
          <h2 id="jobs-h" className="text-lg font-semibold">Jobs ({jobs.length})</h2>
          {samples > 0 && (
            <p className="mt-1 text-sm text-amber-900">
              {samples} {samples === 1 ? "job is" : "jobs are"} sample data from setup. Check each one with your HR team, then press Save to confirm it.
            </p>
          )}
        </div>
        {jobs.length === 0 && <p className="card text-slate-600">No jobs yet. Add one above.</p>}
        {jobs.map((j) => {
          const s = STATUS.find((x) => x.value === j.status)!;
          return (
            <article key={j.id} className="card space-y-4" aria-label={j.title}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{j.title}</h3>
                <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${s.badge}`}>{s.short}</span>
                {j.sample && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-sm font-medium text-amber-900">Sample — check and save</span>}
              </div>
              <JobForm
                key={JSON.stringify(j)}
                job={j}
                busy={busy}
                submitLabel={j.sample ? "Save and confirm" : "Save"}
                onSave={(body) => run(() => send(`/api/settings/jobs/${j.id}`, "PATCH", body), `Saved ${(body as { title: string }).title}.`, j.id)}
              />
              {jobMsg?.id === j.id && (
                <p role={jobMsg.ok ? "status" : "alert"} className={jobMsg.ok ? "alert-success" : "alert-error"}>{jobMsg.text}</p>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
