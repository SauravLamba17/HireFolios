"use client";

import { Chips } from "@/components/chips";
import { latestAdultDob, type IntakeDetailsInput, type Prefill } from "@/lib/intake";
import { activeLabels, type OptionLists } from "@/lib/lists";
import { isCodingJob } from "@/lib/options";

export type Job = { id: string; title: string };

/** Form state as typed (strings for inputs); converted to the shared schema's input on submit. */
export type DetailsState = {
  jobId: string;
  fullName: string;
  dateOfBirth: string;
  email: string;
  city: string;
  education: string;
  experienceYears: string;
  experienceMonths: string;
  currentCtcLpa: string;
  expectedCtcLpa: string;
  noticeDays: string;
  languages: string[];
  source: string;
  hrNotes: string;
  certifications: string[];
  codingSpecialties: string[];
  ehrSoftware: string[];
  nightShiftOk: boolean | null;
  voiceProcess: boolean | null;
  typingWpm: string;
  skills: string;
  // "More details" (optional): another company's offer in hand
  otherCompany: string;
  otherCtcLpa: string;
  otherJoining: string;
};

export const emptyDetails = (): DetailsState => ({
  jobId: "",
  fullName: "",
  dateOfBirth: "",
  email: "",
  city: "",
  education: "",
  experienceYears: "",
  experienceMonths: "",
  currentCtcLpa: "",
  expectedCtcLpa: "",
  noticeDays: "",
  languages: [],
  source: "",
  hrNotes: "",
  certifications: [],
  codingSpecialties: [],
  ehrSoftware: [],
  nightShiftOk: null,
  voiceProcess: null,
  typingWpm: "",
  skills: "",
  otherCompany: "",
  otherCtcLpa: "",
  otherJoining: "",
});

const str = (v: string | number | null) => (v === null ? "" : String(v));

/** Returning candidate: everything saved last time, and the last position if it is still open. List values that
 * are no longer offered (retired in Settings → Lists) are left out: they stay on the old record, HR picks again. */
export function detailsFromPrefill(p: Prefill, openJobs: Job[], lists: OptionLists): DetailsState {
  const keep = (vals: string[], key: Parameters<typeof activeLabels>[1]) => vals.filter((v) => activeLabels(lists, key).includes(v));
  const days = lists.notice_period.filter((n) => n.active).map((n) => n.days);
  return {
    ...emptyDetails(),
    jobId: openJobs.some((j) => j.id === p.lastJobId) ? (p.lastJobId ?? "") : "",
    fullName: p.fullName,
    dateOfBirth: p.dateOfBirth ?? "",
    email: p.email ?? "",
    city: p.city ?? "",
    education: activeLabels(lists, "education").includes(p.education ?? "") ? p.education! : "",
    experienceYears: p.experienceMonths === null ? "" : String(Math.floor(p.experienceMonths / 12)),
    experienceMonths: p.experienceMonths === null ? "" : String(p.experienceMonths % 12),
    currentCtcLpa: str(p.currentCtcLpa),
    expectedCtcLpa: str(p.expectedCtcLpa),
    noticeDays: days.includes(p.noticeDays) ? str(p.noticeDays) : "",
    languages: keep(p.languages, "language"),
    certifications: keep(p.certifications, "certification"),
    codingSpecialties: keep(p.codingSpecialties, "coding_specialty"),
    ehrSoftware: keep(p.ehrSoftware, "ehr_software"),
    nightShiftOk: p.nightShiftOk,
    voiceProcess: p.voiceProcess,
    typingWpm: str(p.typingWpm),
    skills: p.skills ?? "",
  };
}

const optNum = (v: string) => (v.trim() === "" ? null : Number(v));
const reqNum = (v: string) => (v.trim() === "" ? undefined : Number(v));

/** Shape the shared zod schema expects. Wrong values are left for the schema to report. */
export function toDetailsInput(d: DetailsState): IntakeDetailsInput {
  const { otherCompany, otherCtcLpa, otherJoining, ...rest } = d;
  const hasOffer = otherCompany.trim() !== "" || otherCtcLpa.trim() !== "" || otherJoining !== "";
  return {
    ...rest,
    otherOffer: hasOffer ? { company: otherCompany, offeredCtcLpa: optNum(otherCtcLpa), joiningDate: otherJoining || null } : null,
    experienceYears: reqNum(d.experienceYears) as number,
    experienceMonths: reqNum(d.experienceMonths) as number,
    currentCtcLpa: optNum(d.currentCtcLpa),
    expectedCtcLpa: optNum(d.expectedCtcLpa),
    noticeDays: reqNum(d.noticeDays) as number,
    typingWpm: optNum(d.typingWpm),
    nightShiftOk: d.nightShiftOk as boolean,
    voiceProcess: d.voiceProcess as boolean,
  };
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}

function YesNo({ label, value, onChange, error, id }: { id: string; label: string; value: boolean | null; onChange: (v: boolean) => void; error?: string }) {
  return (
    <div>
      <span id={id} className="label">{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="flex gap-2">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={`h-12 flex-1 rounded-lg border text-base font-medium ${
              value === v ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            }`}
          >
            {v ? "Yes" : "No"}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}

export function DetailsForm({
  value: d,
  onChange,
  errors,
  jobs,
  lists,
}: {
  value: DetailsState;
  onChange: (patch: Partial<DetailsState>) => void;
  errors: Record<string, string>;
  jobs: Job[];
  lists: OptionLists;
}) {
  const EDUCATION = activeLabels(lists, "education");
  const SOURCES = activeLabels(lists, "source");
  const LANGUAGES = activeLabels(lists, "language");
  const CERTIFICATIONS = activeLabels(lists, "certification");
  const CODING_SPECIALTIES = activeLabels(lists, "coding_specialty");
  const EHR_SOFTWARE = activeLabels(lists, "ehr_software");
  const NOTICE_PERIODS = lists.notice_period.filter((n) => n.active && n.days !== null);
  const set = <K extends keyof DetailsState>(k: K) => (v: DetailsState[K]) => onChange({ [k]: v } as Partial<DetailsState>);
  const input = (k: keyof DetailsState) => ({
    id: k,
    value: d[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ [k]: e.target.value }),
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": errors[k] ? `${k}-error` : undefined,
  });
  const job = jobs.find((j) => j.id === d.jobId);
  const showSpecialties = (job && isCodingJob(job.title)) || d.certifications.length > 0 || d.codingSpecialties.length > 0;

  return (
    <div className="space-y-8">
      <section aria-labelledby="pos-h" className="space-y-3">
        <h2 id="pos-h" className="text-lg font-semibold">Position</h2>
        {jobs.length === 0 ? (
          <p className="alert-error">No open positions. An admin can open one in Settings.</p>
        ) : (
          <div role="radiogroup" aria-label="Position" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {jobs.map((j) => (
              <button
                key={j.id}
                type="button"
                role="radio"
                aria-checked={d.jobId === j.id}
                onClick={() => onChange({ jobId: j.id })}
                className={`min-h-14 rounded-lg border px-4 py-2 text-left text-base font-medium ${
                  d.jobId === j.id ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                {j.title}
              </button>
            ))}
          </div>
        )}
        {errors.jobId && <p className="text-sm font-medium text-red-700">{errors.jobId}</p>}
      </section>

      {/* Two columns on wide screens: the candidate on the left, RCM + HR notes on the right. */}
      <div className="grid gap-8 xl:grid-cols-2">
      <section aria-labelledby="per-h" className="space-y-4">
        <h2 id="per-h" className="text-lg font-semibold">Candidate</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="fullName" label="Full name" error={errors.fullName}>
              <input {...input("fullName")} autoComplete="off" autoCapitalize="words" maxLength={100} className="input" />
            </Field>
          </div>
          <Field id="dateOfBirth" label="Date of birth" error={errors.dateOfBirth} hint="Must be 18 or older.">
            <input {...input("dateOfBirth")} type="date" min="1940-01-01" max={latestAdultDob()} className="input" />
          </Field>
          <Field id="email" label="Email (optional)" error={errors.email}>
            <input {...input("email")} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" maxLength={254} className="input" />
          </Field>
          <Field id="city" label="City" error={errors.city}>
            <input {...input("city")} autoComplete="off" autoCapitalize="words" maxLength={100} className="input" />
          </Field>
          <Field id="education" label="Education" error={errors.education}>
            <select {...input("education")} className="input">
              <option value="">Choose…</option>
              {EDUCATION.map((e) => <option key={e}>{e}</option>)}
            </select>
          </Field>
          <div>
            <span className="label">Experience</span>
            <div className="flex gap-2">
              <select {...input("experienceYears")} aria-label="Experience years" className="input">
                <option value="">Years…</option>
                {Array.from({ length: 31 }, (_, i) => <option key={i} value={i}>{i} {i === 1 ? "year" : "years"}</option>)}
              </select>
              <select {...input("experienceMonths")} aria-label="Experience months" className="input">
                <option value="">Months…</option>
                {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>{i} {i === 1 ? "month" : "months"}</option>)}
              </select>
            </div>
            {(errors.experienceYears || errors.experienceMonths) && (
              <p className="mt-1 text-sm font-medium text-red-700">{errors.experienceYears ?? errors.experienceMonths}</p>
            )}
          </div>
          <Field id="noticeDays" label="Notice period" error={errors.noticeDays}>
            <select {...input("noticeDays")} className="input">
              <option value="">Choose…</option>
              {NOTICE_PERIODS.map((n) => <option key={n.id} value={n.days ?? ""}>{n.label}</option>)}
            </select>
          </Field>
          <Field id="currentCtcLpa" label="Current CTC (LPA, optional)" error={errors.currentCtcLpa} hint="Lakh per year, e.g. 2.4">
            <input {...input("currentCtcLpa")} type="number" inputMode="decimal" min={0} max={100} step={0.01} className="input" />
          </Field>
          <Field id="expectedCtcLpa" label="Expected CTC (LPA, optional)" error={errors.expectedCtcLpa} hint="Lakh per year, e.g. 3.5">
            <input {...input("expectedCtcLpa")} type="number" inputMode="decimal" min={0} max={100} step={0.01} className="input" />
          </Field>
          <div className="sm:col-span-2">
            <Field id="source" label="How did they hear about us?" error={errors.source}>
              <select {...input("source")} className="input">
                <option value="">Choose…</option>
                {SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <div>
          <span className="label">Languages spoken (optional)</span>
          <Chips label="Languages spoken" options={LANGUAGES} value={d.languages} onChange={set("languages")} />
        </div>
      </section>

      <div className="space-y-8">
      <section aria-labelledby="rcm-h" className="space-y-4">
        <h2 id="rcm-h" className="text-lg font-semibold">Medical billing / RCM</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <YesNo id="night-l" label="OK with night / US shift?" value={d.nightShiftOk} onChange={set("nightShiftOk")} error={errors.nightShiftOk} />
          <YesNo id="voice-l" label="OK with voice process (calls)?" value={d.voiceProcess} onChange={set("voiceProcess")} error={errors.voiceProcess} />
        </div>
        <div>
          <span className="label">Certifications (optional)</span>
          <Chips label="Certifications" options={CERTIFICATIONS} value={d.certifications} onChange={set("certifications")} />
        </div>
        {showSpecialties && (
          <div>
            <span className="label">Coding specialties (optional)</span>
            <Chips label="Coding specialties" options={CODING_SPECIALTIES} value={d.codingSpecialties} onChange={set("codingSpecialties")} />
          </div>
        )}
        <div>
          <span className="label">EHR / PM software used (optional)</span>
          <Chips label="EHR / PM software" options={EHR_SOFTWARE} value={d.ehrSoftware} onChange={set("ehrSoftware")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="typingWpm" label="Typing speed (WPM, optional)" error={errors.typingWpm}>
            <input {...input("typingWpm")} type="number" inputMode="numeric" min={1} max={250} step={1} className="input" />
          </Field>
        </div>
        <Field id="skills" label="Skills (optional)" error={errors.skills} hint="e.g. denial codes, Excel, payer portals">
          <textarea {...input("skills")} rows={2} maxLength={500} className="input h-auto py-2" />
        </Field>
      </section>

      <details className="rounded-lg border border-slate-200 p-4" data-testid="more-details" open={Object.keys(errors).some((k) => k.startsWith("otherOffer")) || undefined}>
        <summary className="cursor-pointer text-lg font-semibold">More details (optional)</summary>
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-600">Another offer the candidate already has. Only HR sees this. Leave empty to skip.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="otherCompany" label="Other offer: company" error={errors["otherOffer.company"]}>
              <input {...input("otherCompany")} autoComplete="off" maxLength={100} className="input" />
            </Field>
            <Field id="otherCtcLpa" label="Offered CTC (LPA)" error={errors["otherOffer.offeredCtcLpa"]}>
              <input {...input("otherCtcLpa")} type="number" inputMode="decimal" min={0} max={100} step={0.01} className="input" />
            </Field>
            <Field id="otherJoining" label="Their joining date" error={errors["otherOffer.joiningDate"]}>
              <input {...input("otherJoining")} type="date" className="input" />
            </Field>
          </div>
        </div>
      </details>

      <section aria-labelledby="hr-h" className="space-y-2">
        <h2 id="hr-h" className="text-lg font-semibold">HR notes</h2>
        <Field id="hrNotes" label="Notes for the interview panel (optional)" error={errors.hrNotes}>
          <textarea {...input("hrNotes")} rows={3} maxLength={1000} className="input h-auto py-2" />
        </Field>
      </section>
      </div>
      </div>
    </div>
  );
}
