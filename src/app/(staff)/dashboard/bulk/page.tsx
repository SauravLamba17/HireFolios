import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { RediscoveryTabs } from "@/components/rediscovery-tabs";
import { formatDayIST, todayIST } from "@/lib/ist";
import { activeLabels } from "@/lib/lists";
import { getOptionLists } from "@/lib/lists-db";
import { formatLpa } from "@/lib/money";
import { bulkList, bulkQuery, EXCLUSIONS, parseBulk, pushesOf } from "@/lib/rediscovery/pool";
import { WEIGHT_LABELS, type Weights } from "@/lib/rediscovery/rank";
import { can, requireStaff } from "@/lib/session";
import { SavePush } from "./save-push";

export const metadata: Metadata = { title: "Bulk hiring" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const SHOW = 200;

export default async function BulkPage({ searchParams }: Props) {
  const staff = await requireStaff("rediscovery");
  const params = await searchParams;
  const run = params.needed !== undefined;
  const b = parseBulk(params);
  const [lists, jobRows] = await Promise.all([
    getOptionLists(staff.tenantId),
    db.select({ id: jobs.id, title: jobs.title }).from(jobs).where(and(eq(jobs.tenantId, staff.tenantId))).orderBy(asc(jobs.title)),
  ]);
  const result = run ? await bulkList(staff.tenantId, b) : null;
  const shown = result?.rows.slice(0, SHOW) ?? [];
  const inPush = result ? await pushesOf(staff.tenantId, shown.map((r) => r.id)) : new Map();
  const jobNames = jobRows.filter((j) => b.jobs.includes(j.id)).map((j) => j.title);
  const month = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date());
  const check = (name: string, value: string, label: string, on: boolean) => (
    <label key={value} className="flex min-h-10 items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value} defaultChecked={on} className="size-5 accent-blue-700" /> {label}
    </label>
  );

  return (
    <div className="space-y-6">
      <RediscoveryTabs />
      <div>
        <h1 className="text-2xl font-semibold">Bulk hiring</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Build a ranked call list from people we already know: tagged pools, near-misses, cost rejections, declined offers, people on hold and the talent pool.
          Nobody is contacted automatically; every row says why it is on the list.
        </p>
      </div>

      <form method="get" className="card space-y-4" aria-label="Bulk hiring criteria">
        <fieldset>
          <legend className="label">Positions (people who applied for one of them; none = any)</legend>
          <div className="flex flex-wrap gap-x-5">{jobRows.map((j) => check("jobs", j.id, j.title, b.jobs.includes(j.id)))}</div>
        </fieldset>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="b-needed" className="label">Number needed</label>
            <input id="b-needed" name="needed" type="number" min={1} max={500} required defaultValue={b.needed} className="input" />
          </div>
          <div>
            <label htmlFor="b-budget" className="label">Max budget (LPA)</label>
            <input id="b-budget" name="budget" type="number" min={0.1} max={100} step={0.1} defaultValue={b.budget ?? ""} className="input" />
          </div>
          <div>
            <label htmlFor="b-exp" className="label">Minimum experience (years, optional)</label>
            <input id="b-exp" name="minExp" type="number" min={0} max={45} step={0.5} defaultValue={b.minExp ?? ""} className="input" />
          </div>
        </div>
        <fieldset>
          <legend className="label">Certifications wanted (optional)</legend>
          <div className="flex flex-wrap gap-x-5">{activeLabels(lists, "certification").map((c) => check("cert", c, c, b.cert.includes(c)))}</div>
        </fieldset>
        <fieldset>
          <legend className="label">Software wanted (optional)</legend>
          <div className="flex flex-wrap gap-x-5">{activeLabels(lists, "ehr_software").map((c) => check("ehr", c, c, b.ehr.includes(c)))}</div>
        </fieldset>
        <fieldset>
          <legend className="label">Shift</legend>
          <div className="flex flex-wrap gap-x-5">
            {check("night", "yes", "Night / US shift needed", Boolean(b.night))}
            {check("voice", "yes", "Voice process (calls) needed", Boolean(b.voice))}
          </div>
        </fieldset>
        <button type="submit" className="btn btn-primary">Build the list</button>
      </form>

      {result && (
        <>
          <section className="grid gap-4 md:grid-cols-2">
            <div className="card space-y-2" aria-labelledby="how-h">
              <h2 id="how-h" className="font-semibold">How this list is ranked</h2>
              <ul className="text-sm text-slate-700">
                {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((k) => (
                  <li key={k}>{WEIGHT_LABELS[k]}: weight {result.weights[k]}</li>
                ))}
              </ul>
              <p className="text-sm text-slate-600">
                Up to {result.settings.bulk_over_budget_percent}% over budget is listed lower; last visit within {result.settings.bulk_recency_months} months. Change
                these in Settings → Rediscovery.
              </p>
            </div>
            <div className="card space-y-2" aria-labelledby="exc-h">
              <h2 id="exc-h" className="font-semibold">Always left out</h2>
              <ul className="text-sm text-slate-700" data-testid="exclusions">
                {(Object.keys(EXCLUSIONS) as (keyof typeof EXCLUSIONS)[]).map((k) => (
                  <li key={k}>{EXCLUSIONS[k]}: {result.excluded[k]}</li>
                ))}
              </ul>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              {result.rows.length} {result.rows.length === 1 ? "person" : "people"} · {b.needed} needed{b.budget !== undefined && ` · budget ${b.budget} LPA`}
            </h2>
            {can(staff.role, "export") && result.rows.length > 0 && <a href={`/api/exports/bulk?${bulkQuery(b)}`} className="btn btn-secondary">Export to Excel</a>}
          </div>
          {result.rows.length > 0 && (
            <SavePush criteria={b as unknown as Record<string, unknown>} count={result.rows.length} suggestedName={`${jobNames.join(", ") || "Bulk push"} — ${month}`} />
          )}
          {result.rows.length === 0 ? (
            <p className="card text-slate-600">Nobody matches. Try a higher budget, fewer requirements or other positions.</p>
          ) : (
            <ol className="space-y-2" aria-label="Ranked list">
              {shown.map((r, i) => (
                <li key={r.id} className={`card flex flex-wrap items-start gap-3 p-3 ${i < b.needed ? "border-blue-300" : ""}`} aria-label={`Rank ${i + 1}: ${r.full_name}`}>
                  <span className="w-10 text-lg font-semibold text-slate-500">#{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={`/dashboard/candidates/${r.id}`} className="font-semibold text-blue-800 underline">{r.full_name}</Link>
                      <span className="text-sm text-slate-600">{r.mobile}{r.city ? ` · ${r.city}` : ""} · expects {formatLpa(r.expected_ctc) ?? "—"} · last visit {formatDayIST(r.last_visit)}</span>
                      {(inPush.get(r.id) ?? []).map((p: { id: string; name: string }) => (
                        <Link key={p.id} href={`/dashboard/pushes/${p.id}`} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">already in push {p.name}</Link>
                      ))}
                    </p>
                    <p className="text-sm text-slate-800" data-testid="why">{r.ranked.why}</p>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-2 py-1 text-sm font-semibold" title="Ranking score (0–100)">{r.ranked.score}</span>
                </li>
              ))}
            </ol>
          )}
          {result.rows.length > SHOW && <p className="text-sm text-slate-600">Showing the top {SHOW}. Narrow the criteria to see others.</p>}
        </>
      )}
      <p className="text-sm text-slate-500">List built {formatDayIST(todayIST())}; it changes as people are contacted, tagged or hired.</p>
    </div>
  );
}
