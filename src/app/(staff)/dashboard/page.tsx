import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, outcomeEnum } from "@/db/schema";
import { StatusBadge, Tag } from "@/components/status-badge";
import { StatusCard } from "@/components/status-card";
import { PAGE_SIZE, parseFilters, searchCandidates, type Filters } from "@/lib/candidate-search";
import { formatDayIST } from "@/lib/ist";
import { formatLpa } from "@/lib/money";
import { getOptionLists } from "@/lib/lists-db";
import { experienceLabel, OUTCOME_LABELS } from "@/lib/options";
import { can, ROLE_LABELS, requireStaff } from "@/lib/session";
import { callbacksDueCount } from "@/lib/rediscovery/callbacks";

export const metadata: Metadata = { title: "Candidates" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** URL for the same search with some values changed (filters live in the URL). */
function hrefWith(f: Filters, patch: Partial<Filters>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...patch })) {
    if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
  }
  const qs = p.toString();
  return qs ? `/dashboard?${qs}` : "/dashboard";
}

export default async function DashboardPage({ searchParams }: Props) {
  const staff = await requireStaff("dashboard");
  if (!can(staff.role, "candidates")) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <div className="card space-y-2">
          <p className="text-lg">
            Signed in as <strong>{staff.name}</strong> ({ROLE_LABELS[staff.role]}).
          </p>
          <p className="text-slate-600">Your interview queue and scorecards will appear here in the next phase.</p>
        </div>
      </div>
    );
  }

  const f = parseFilters(await searchParams);
  const [{ rows, total }, jobList, lists, dueCallbacks] = await Promise.all([
    searchCandidates(f, staff.tenantId),
    db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(eq(jobs.tenantId, staff.tenantId)).orderBy(asc(jobs.title)),
    getOptionLists(staff.tenantId),
    can(staff.role, "rediscovery") ? callbacksDueCount(staff.tenantId) : Promise.resolve(0),
  ]);
  // Retired list items stay in the filters (older candidates have them), after the current ones.
  const filterOptions = (items: typeof lists.certification) =>
    [...items.filter((i) => i.active), ...items.filter((i) => !i.active)].map((i) => (
      <option key={i.id} value={i.label}>{i.active ? i.label : `${i.label} (no longer offered)`}</option>
    ));
  const filtered = hrefWith(f, { page: 1 }) !== "/dashboard";
  const first = (f.page - 1) * PAGE_SIZE + 1;

  return (
    <div className="space-y-6">
      {dueCallbacks > 0 && (
        <Link href="/dashboard/callbacks" className="card flex items-center justify-between gap-4 border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100" data-testid="callbacks-card">
          <span className="text-lg font-semibold">Call-backs due: {dueCallbacks}</span>
          <span className="underline">Open call-backs →</span>
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Candidates</h1>
          {total > 0 && (
            <p className="mt-1 text-slate-600">
              {total} candidate{total === 1 ? "" : "s"}
              {filtered ? " match" : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {can(staff.role, "export") && total > 0 && (
            // a plain link: the browser downloads the .xlsx with the same filters as this list
            <a href={`/api/exports/candidates${hrefWith(f, { page: 1 }).replace("/dashboard", "")}`} className="btn btn-secondary">
              Export to Excel
            </a>
          )}
          {can(staff.role, "intake") && (
            <Link href="/intake" className="btn btn-primary">+ New candidate</Link>
          )}
        </div>
      </div>

      {can(staff.role, "settings") && <StatusCard tenantId={staff.tenantId} />}

      <form method="get" action="/dashboard" className="card grid gap-4 md:grid-cols-4" role="search" aria-label="Search candidates">
        <div className="md:col-span-4">
          <label htmlFor="q" className="label">Search</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={f.q}
            maxLength={100}
            placeholder="Name, mobile (4+ digits), email, city, skill, certification, software…"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="job" className="label">Position</label>
          <select id="job" name="job" defaultValue={f.job ?? ""} className="input">
            <option value="">Any</option>
            {jobList.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="label">Status</label>
          <select id="status" name="status" defaultValue={f.status ?? ""} className="input">
            <option value="">Any</option>
            {outcomeEnum.enumValues.map((o) => <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="from" className="label">Visit from</label>
          <input id="from" name="from" type="date" defaultValue={f.from} className="input" />
        </div>
        <div>
          <label htmlFor="to" className="label">Visit to</label>
          <input id="to" name="to" type="date" defaultValue={f.to} className="input" />
        </div>
        <div>
          <label htmlFor="cert" className="label">Certification</label>
          <select id="cert" name="cert" defaultValue={f.cert ?? ""} className="input">
            <option value="">Any</option>
            {filterOptions(lists.certification)}
          </select>
        </div>
        <div>
          <label htmlFor="ehr" className="label">EHR / PM software</label>
          <select id="ehr" name="ehr" defaultValue={f.ehr ?? ""} className="input">
            <option value="">Any</option>
            {filterOptions(lists.ehr_software)}
          </select>
        </div>
        <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 md:col-span-2">
          <legend className="label">Only</legend>
          {(
            [
              ["night", "Night shift OK", f.night],
              ["voice", "Voice process OK", f.voice],
              ["pool", "Talent pool", f.pool],
            ] as const
          ).map(([name, label, on]) => (
            <label key={name} className="flex h-12 cursor-pointer items-center gap-2 text-base">
              <input type="checkbox" name={name} value="yes" defaultChecked={on === "yes"} className="size-5 accent-blue-700" />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-2 md:col-span-4">
          <button type="submit" className="btn btn-primary">Search</button>
          {filtered && <Link href="/dashboard" className="btn btn-secondary">Clear</Link>}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card text-center">
          <p className="text-lg font-medium">No candidates match</p>
          {f.page > 1 ? (
            <Link href={hrefWith(f, { page: 1 })} className="mt-1 inline-block text-blue-700 underline">Go to the first page</Link>
          ) : (
            <p className="mt-1 text-slate-600">{filtered ? "Try fewer filters or another spelling." : "Registered walk-ins will show up here."}</p>
          )}
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Candidates">
          {rows.map((r) => (
            <li key={r.id} className="card flex flex-wrap gap-4 p-4">
              {r.photo_id ? (
                <Image src={`/api/files/${r.photo_id}`} unoptimized width={64} height={85} alt="" loading="lazy" className="h-[85px] w-16 rounded-md object-cover" />
              ) : (
                <div className="grid h-[85px] w-16 place-items-center rounded-md bg-slate-100 text-xs text-slate-500">No photo</div>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <Link href={`/dashboard/candidates/${r.id}`} className="text-lg font-semibold text-blue-800 underline-offset-2 hover:underline">
                  {r.full_name}
                </Link>
                <p className="text-slate-700">
                  {r.mobile}
                  {r.city && ` · ${r.city}`}
                </p>
                <p className="text-sm text-slate-600">
                  {[r.job, experienceLabel(r.experience_months), r.expected_ctc !== null && `Expects ${formatLpa(r.expected_ctc)}`].filter(Boolean).join(" · ")}
                </p>
                {r.certifications.length > 0 && (
                  <p className="text-sm text-slate-600">Certifications: {r.certifications.join(", ")}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5 text-right text-sm">
                {r.token_date && (
                  <span className="text-slate-600">
                    Last visit {formatDayIST(r.token_date)} · {r.token}
                  </span>
                )}
                <StatusBadge outcome={r.outcome} stage={r.stage} />
                {r.talent_pool && <Tag>Talent pool</Tag>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-between gap-4" aria-label="Pages">
          {f.page > 1 ? <Link href={hrefWith(f, { page: f.page - 1 })} className="btn btn-secondary">← Previous</Link> : <span />}
          <span className="text-slate-600">
            {first}–{Math.min(first + rows.length - 1, total)} of {total}
          </span>
          {f.page * PAGE_SIZE < total ? <Link href={hrefWith(f, { page: f.page + 1 })} className="btn btn-secondary">Next →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
