import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { PersonContact } from "@/components/person-contact";
import { RediscoveryTabs } from "@/components/rediscovery-tabs";
import { getCompany } from "@/lib/company";
import { formatDateIST, formatDayIST } from "@/lib/ist";
import { getOptionLists } from "@/lib/lists-db";
import { formatLpa } from "@/lib/money";
import { experienceLabel } from "@/lib/options";
import { contactStates } from "@/lib/rediscovery/data";
import { parsePool, POOL_PAGE, searchPool, type PoolFilter } from "@/lib/rediscovery/pool";
import { getSettings } from "@/lib/rediscovery/settings-db";
import { fmtScore } from "@/lib/rediscovery/summary";
import { can, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Rediscovery pool" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const query = (f: PoolFilter, patch: Partial<PoolFilter> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...patch })) if (v !== undefined && v !== "" && !(k === "page" && v === 1) && !(k === "sort" && v === "score")) p.set(k, String(v));
  return p.toString();
};

export default async function PoolPage({ searchParams }: Props) {
  const staff = await requireStaff("rediscovery");
  const f = parsePool(await searchParams);
  const [{ rows, total }, lists, jobRows, settings, company] = await Promise.all([
    searchPool(staff.tenantId, f),
    getOptionLists(staff.tenantId),
    db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.tenantId, staff.tenantId)).orderBy(asc(jobs.title)),
    getSettings(staff.tenantId),
    getCompany(staff.tenantId),
  ]);
  const ids = rows.map((r) => r.id);
  const [states, photos] = await Promise.all([
    contactStates(staff.tenantId, ids),
    ids.length
      ? db.execute<{ candidate_id: string; id: string }>(sql`
          select distinct on (f.candidate_id) f.candidate_id, f.id from candidate_files f
          where f.tenant_id = ${staff.tenantId} and f.kind = 'photo' and f.deleted_at is null and f.candidate_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
          order by f.candidate_id, f.created_at desc`)
      : Promise.resolve([]),
  ]);
  const photo = new Map([...photos].map((p) => [p.candidate_id, p.id]));
  const pages = Math.max(1, Math.ceil(total / POOL_PAGE));
  const opt = (items: { label: string; active: boolean }[]) => items.map((i) => <option key={i.label} value={i.label}>{i.label}{i.active ? "" : " (retired)"}</option>);

  return (
    <div className="space-y-6">
      <RediscoveryTabs />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Rediscovery pool</h1>
          <p className="mt-1 max-w-3xl text-slate-600">
            Everyone HR tagged as worth another look ({total} {total === 1 ? "person" : "people"}). People who asked not to be contacted are hidden unless you
            tick the box; people who withdrew consent are never shown. Tags never keep data longer than the retention rules.
          </p>
        </div>
        {can(staff.role, "export") && (
          <a href={`/api/exports/pool?${query(f)}`} className="btn btn-secondary">Export to Excel</a>
        )}
      </div>

      <form method="get" className="card grid gap-3 md:grid-cols-4" aria-label="Filter the pool">
        <div>
          <label htmlFor="p-tag" className="label">Tag</label>
          <select id="p-tag" name="tag" defaultValue={f.tag ?? ""} className="input">
            <option value="">Any tag</option>
            {lists.rediscovery_tag.filter((t) => t.code).map((t) => <option key={t.code} value={t.code!}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="p-job" className="label">Position applied for</label>
          <select id="p-job" name="job" defaultValue={f.job ?? ""} className="input">
            <option value="">Any</option>
            {jobRows.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="p-cert" className="label">Certification</label>
          <select id="p-cert" name="cert" defaultValue={f.cert ?? ""} className="input"><option value="">Any</option>{opt(lists.certification)}</select>
        </div>
        <div>
          <label htmlFor="p-ehr" className="label">Software</label>
          <select id="p-ehr" name="ehr" defaultValue={f.ehr ?? ""} className="input"><option value="">Any</option>{opt(lists.ehr_software)}</select>
        </div>
        {(
          [
            ["expMin", "Experience from (years)", 45, 1],
            ["expMax", "Experience to (years)", 45, 1],
            ["ctcMin", "Expected CTC from (LPA)", 100, 0.1],
            ["ctcMax", "Expected CTC to (LPA)", 100, 0.1],
            ["scoreMin", "Avg score from", 5, 0.1],
            ["scoreMax", "Avg score to", 5, 0.1],
          ] as const
        ).map(([k, l, max, step]) => (
          <div key={k}>
            <label htmlFor={`p-${k}`} className="label">{l}</label>
            <input id={`p-${k}`} name={k} type="number" min={0} max={max} step={step} defaultValue={f[k] ?? ""} className="input" />
          </div>
        ))}
        <div>
          <label htmlFor="p-change" className="label">Score change</label>
          <select id="p-change" name="change" defaultValue={f.change ?? ""} className="input">
            <option value="">Any</option>
            <option value="up">Went up</option>
            <option value="down">Went down</option>
          </select>
        </div>
        <div>
          <label htmlFor="p-from" className="label">Last visit from</label>
          <input id="p-from" name="from" type="date" defaultValue={f.from ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="p-to" className="label">Last visit to</label>
          <input id="p-to" name="to" type="date" defaultValue={f.to ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="p-consent" className="label">Talent-pool consent</label>
          <select id="p-consent" name="consent" defaultValue={f.consent ?? ""} className="input">
            <option value="">Any</option>
            <option value="pool">Given</option>
            <option value="none">Not given</option>
          </select>
        </div>
        <div>
          <label htmlFor="p-contacted" className="label">Contacted in the last (days)</label>
          <input id="p-contacted" name="contacted" type="number" min={1} max={365} defaultValue={f.contacted ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="p-sort" className="label">Sort by</label>
          <select id="p-sort" name="sort" defaultValue={f.sort} className="input">
            <option value="score">Avg score</option>
            <option value="change">Score change</option>
            <option value="visit">Last visit</option>
            <option value="ctc">Expected CTC (lowest first)</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-4 md:col-span-2">
          <label className="flex h-12 items-center gap-2"><input type="checkbox" name="due" value="yes" defaultChecked={Boolean(f.due)} className="size-5 accent-blue-700" /> Due for call-back</label>
          <label className="flex h-12 items-center gap-2"><input type="checkbox" name="dnc" value="yes" defaultChecked={Boolean(f.dnc)} className="size-5 accent-blue-700" /> Show do-not-contact</label>
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="btn btn-primary">Filter</button>
          <Link href="/dashboard/pool" className="btn btn-secondary">Clear</Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="card text-slate-600">Nobody in the pool matches. Tag strong people on their profile, or accept suggestions.</p>
      ) : (
        <ul className="space-y-3" aria-label="Pool">
          {rows.map((r) => {
            const st = states.get(r.id)!;
            return (
              <li key={r.id} className="card flex flex-wrap gap-4 p-4" aria-label={`Pool: ${r.full_name}`}>
                {photo.get(r.id) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private file behind the session cookie
                  <img src={`/api/files/${photo.get(r.id)}`} alt="" loading="lazy" className="h-20 w-16 rounded object-cover" />
                ) : (
                  <span className="grid h-20 w-16 place-items-center rounded bg-slate-100 text-xs text-slate-400">No photo</span>
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={`/dashboard/candidates/${r.id}`} className="text-lg font-semibold text-blue-800 underline">{r.full_name}</Link>
                    <span className="text-slate-600">{r.mobile}{r.city ? ` · ${r.city}` : ""}</span>
                    {r.tagLabels.map((t) => <span key={t} className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900">{t}</span>)}
                    {st.dnc && <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs font-medium text-white">Do not contact</span>}
                  </p>
                  <p className="text-sm text-slate-700">
                    {[r.qualification, experienceLabel(r.experience_months), r.expected_ctc !== null && `expects ${formatLpa(r.expected_ctc)}`, r.lastJob].filter(Boolean).join(" · ")}
                  </p>
                  <p className="text-sm text-slate-700" data-testid="pool-scores">
                    Avg {fmtScore(r.avg)}/5{r.change ? ` · ${r.change.text}` : ""} · last visit {formatDayIST(r.last_visit)}
                    {" · "}last contacted {st.lastContact ? formatDateIST(st.lastContact.at) : "never"}
                    {" · "}{r.in_pool ? "talent-pool consent" : "no talent-pool consent"}
                    {r.callback_due && <span className="font-medium text-amber-900"> · call-back due</span>}
                  </p>
                  <p className="text-sm text-slate-600">{r.line}</p>
                  <PersonContact person={{ id: r.id, name: r.full_name, mobile: r.mobile }} state={st} settings={settings} company={company.shortName} hrName={staff.name} position={r.lastJob ?? ""} purpose="other" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center gap-3">
          {f.page > 1 && <Link href={`/dashboard/pool?${query(f, { page: f.page - 1 })}`} className="btn btn-secondary">← Previous</Link>}
          <span className="text-slate-600">Page {f.page} of {pages}</span>
          {f.page < pages && <Link href={`/dashboard/pool?${query(f, { page: f.page + 1 })}`} className="btn btn-secondary">Next →</Link>}
        </nav>
      )}
    </div>
  );
}
