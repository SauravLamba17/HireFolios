// Profile "Summary" card (docs/REDISCOVERY.md C4): the candidate's story at a glance. Server component; the HR-only
// parts (tags, suggestions, other offers, cost figures) are passed only when the viewer may see them.
import { SuggestionCard, TagEditor } from "@/components/rediscovery";
import { formatDateIST, formatDayIST } from "@/lib/ist";
import { formatLpa } from "@/lib/money";
import { experienceLabel } from "@/lib/options";
import type { CandidateInsight } from "@/lib/rediscovery/data";
import { fmtScore } from "@/lib/rediscovery/summary";

export type SummaryPerson = {
  id: string;
  fullName: string;
  age: number | null;
  city: string | null;
  qualification: string | null;
  certifications: string[];
  ehrSoftware: string[];
  experienceMonths: number | null;
  languages: string[];
};

export type HrExtras = {
  otherOffer: { company: string | null; offeredCtc: number | null; joiningDate: string | null; notedOn: string } | null;
  tagOptions: { code: string; label: string }[];
  /** extra lines (call-back, last contacted, risk hints...) added by later sub-phases */
  facts: { label: string; value: React.ReactNode; tone?: "warn" | "ok" }[];
};

const STATUS_TONE: Record<string, string> = {
  hired: "bg-emerald-600 text-white",
  selected: "bg-green-50 text-green-800",
  not_hired: "bg-red-50 text-red-800",
  didnt_finish: "bg-slate-200 text-slate-700",
  in_progress: "bg-blue-50 text-blue-800",
  on_hold: "bg-amber-50 text-amber-900",
};

export function SummaryCard({ person: p, insight: s, keep, hr }: { person: SummaryPerson; insight: CandidateInsight; keep: string; hr: HrExtras | null }) {
  const who = [
    p.age !== null && `${p.age} yrs`,
    p.city,
    p.qualification,
    experienceLabel(p.experienceMonths),
    p.certifications.length > 0 && p.certifications.join(", "),
    p.ehrSoftware.length > 0 && p.ehrSoftware.join(", "),
    p.languages.length > 0 && p.languages.join(", "),
  ].filter(Boolean);
  const oo = hr?.otherOffer;
  return (
    <section className="card space-y-4 border-blue-200" aria-labelledby="sum-h" data-testid="summary-card">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="sum-h" className="text-lg font-semibold">Summary</h2>
        {s.latest && <span className={`rounded-full px-2.5 py-1 text-sm font-medium ${STATUS_TONE[s.latest.status]}`}>{s.latest.statusLabel}</span>}
        <span className="text-sm text-slate-600">{s.visits.length} visit{s.visits.length === 1 ? "" : "s"}</span>
      </div>
      <p className="text-slate-700">{who.join(" · ") || "No details recorded."}</p>
      <p className="text-base font-medium text-slate-900" data-testid="summary-line">{s.line}</p>

      {s.visits.length > 0 && (
        <ol className="space-y-1 text-sm" aria-label="Visits at a glance">
          {s.visits.map((v) => (
            <li key={v.id} className="flex flex-wrap gap-x-2 border-l-2 border-slate-200 pl-3">
              <span className="font-medium whitespace-nowrap">{formatDayIST(v.day)}</span>
              <span>· {v.job}</span>
              <span>· {v.rounds.length ? v.rounds.map((r) => r.name).join(" → ") : "no rounds"}</span>
              <span>· {v.statusLabel}</span>
              {v.reason && <span className="text-slate-700">· {v.reason}</span>}
              {v.avg !== null && <span className="text-slate-700">· avg {fmtScore(v.avg)}/5</span>}
              {v.strongest && v.weakest && (
                <span className="text-slate-500">
                  · best {v.strongest.label} {fmtScore(v.strongest.avg)}, weakest {v.weakest.label} {fmtScore(v.weakest.avg)}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Score change</dt>
          <dd data-testid="score-change">{s.change ? `${s.change.text}` : "Needs two visits with scores"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Data</dt>
          <dd data-testid="summary-keep">{keep}</dd>
        </div>
        {hr && (
          <div>
            <dt className="text-slate-500">Other offer in hand</dt>
            <dd>
              {oo
                ? [oo.company ?? "Company not given", oo.offeredCtc !== null && formatLpa(oo.offeredCtc), oo.joiningDate && `joining ${formatDayIST(oo.joiningDate)}`, `noted ${formatDayIST(oo.notedOn)}`].filter(Boolean).join(" · ")
                : "None noted"}
            </dd>
          </div>
        )}
        {hr?.facts.map((f) => (
          <div key={f.label}>
            <dt className="text-slate-500">{f.label}</dt>
            <dd className={f.tone === "warn" ? "font-medium text-amber-900" : undefined}>{f.value}</dd>
          </div>
        ))}
      </dl>

      {s.latest?.notes[0] && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm">
          <span className="text-slate-500">Latest interviewer note ({s.latest.notes[0].stage}, {s.latest.notes[0].interviewer ?? "—"}):</span> {s.latest.notes[0].text}
        </p>
      )}

      {hr && (
        <div className="space-y-3 border-t border-slate-100 pt-3" aria-label="Tags and suggestions (HR only)">
          <h3 className="font-semibold">Tags <span className="text-sm font-normal text-slate-500">(HR only)</span></h3>
          {s.suggestions.map((g) => (
            <SuggestionCard key={g.tag} candidateId={p.id} tag={g.tag} label={g.label} reason={g.reason} />
          ))}
          {s.suggestionNote && <p className="text-sm text-slate-600">{s.suggestionNote}</p>}
          <TagEditor
            candidateId={p.id}
            canTag={s.visits.some((v) => v.decidedAt)}
            options={hr.tagOptions}
            tags={s.tags.map((t) => ({ id: t.id, code: t.code, label: t.label, note: t.note, by: t.by, at: formatDateIST(t.at), source: t.source }))}
          />
        </div>
      )}
    </section>
  );
}
