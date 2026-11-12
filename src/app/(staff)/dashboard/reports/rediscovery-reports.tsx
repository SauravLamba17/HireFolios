// Phase 3.6 report sections (docs/REDISCOVERY.md F2): every figure from real rows in the chosen IST date range
// (pool size and call-backs due are "now"). Server component.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { APP_TIME_ZONE, todayIST } from "@/lib/ist";
import { getOptionLists } from "@/lib/lists-db";
import { rupeesToLpa } from "@/lib/money";
import { CONTACT_OUTCOMES } from "@/lib/rediscovery/contact";
import { categoryMap, categoryOf, tagLabels } from "@/lib/rediscovery/data";
import { RISK_LABELS, type RiskCode } from "@/lib/rediscovery/risk";
import { rate } from "@/lib/reports";

const n = (v: unknown) => Number(v ?? 0);
const lpa = (v: unknown) => (v === null || v === undefined ? "—" : `${rupeesToLpa(Math.round(Number(v)))} LPA`);

function Table({ label, head, rows }: { label: string; head: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">No data in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[360px] text-left text-sm" aria-label={label}>
        <thead className="border-b border-slate-200 text-slate-600">
          <tr>{head.map((h) => <th key={h} className="py-2 pr-4 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={`py-2 pr-4 ${j ? "tabular-nums" : ""}`}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function RediscoveryReports({ tenantId, from, to }: { tenantId: string; from: string; to: string }) {
  const day = (col: string) => sql`(${sql.raw(col)} at time zone ${APP_TIME_ZONE})::date between ${from}::date and ${to}::date`;
  const lists = await getOptionLists(tenantId);
  const cats = categoryMap(lists);
  const tags = tagLabels(lists);
  const [whyRows, byPos, [cost], pool, sugAcc, sugDis, [cbNow], cbDone, pushes, risk] = await Promise.all([
    db.execute<{ cat: string | null; n: number }>(sql`
      select a.reject_category as cat, count(*)::int as n from applications a
      where a.tenant_id = ${tenantId} and a.outcome in ('rejected', 'offer_declined', 'no_show', 'withdrawn') and ${day("a.decided_at")}
      group by 1 order by 2 desc`),
    db.execute<{ job: string; cat: string | null; n: number }>(sql`
      select j.title as job, a.reject_category as cat, count(*)::int as n from applications a join jobs j on j.id = a.job_id
      where a.tenant_id = ${tenantId} and a.outcome in ('rejected', 'offer_declined') and ${day("a.decided_at")}
      group by 1, 2 order by 1, 3 desc`),
    db.execute<{ n: number; with_both: number; expected: number | null; budget: number | null; gap: number | null; no_budget: number }>(sql`
      select count(*)::int as n,
             count(*) filter (where a.cost_expected_ctc is not null and a.cost_budget_ctc is not null)::int as with_both,
             avg(a.cost_expected_ctc) filter (where a.cost_budget_ctc is not null) as expected,
             avg(a.cost_budget_ctc) filter (where a.cost_expected_ctc is not null) as budget,
             avg((a.cost_expected_ctc - a.cost_budget_ctc) * 100.0 / nullif(a.cost_budget_ctc, 0)) as gap,
             count(*) filter (where a.cost_budget_ctc is null)::int as no_budget
      from applications a where a.tenant_id = ${tenantId} and a.reject_category = 'cost' and ${day("a.decided_at")}`),
    db.execute<{ tag: string; n: number }>(sql`
      select t.tag_code as tag, count(*)::int as n from candidate_tags t where t.tenant_id = ${tenantId} and t.removed_at is null group by 1 order by 2 desc`),
    db.execute<{ tag: string; n: number }>(sql`
      select t.tag_code as tag, count(*)::int as n from candidate_tags t where t.tenant_id = ${tenantId} and t.source = 'suggestion' and ${day("t.added_at")} group by 1`),
    db.execute<{ tag: string; n: number }>(sql`
      select d.tag_code as tag, count(*)::int as n from suggestion_dismissals d where d.tenant_id = ${tenantId} and ${day("d.dismissed_at")} group by 1`),
    db.execute<{ due: number; upcoming: number }>(sql`
      select count(*) filter (where b.due_on <= ${todayIST()}::date)::int as due, count(*) filter (where b.due_on > ${todayIST()}::date)::int as upcoming
      from callbacks b where b.tenant_id = ${tenantId} and b.status = 'open'`),
    db.execute<{ outcome: string | null; n: number }>(sql`
      select b.outcome, count(*)::int as n from callbacks b where b.tenant_id = ${tenantId} and b.status = 'done' and ${day("b.done_at")} group by 1 order by 2 desc`),
    db.execute<{ name: string; members: number; called: number; interested: number; booked: number; hired: number }>(sql`
      select p.name, count(m.id)::int as members,
        count(m.id) filter (where m.status <> 'to_call')::int as called,
        count(m.id) filter (where m.status in ('interested', 'booked', 'hired'))::int as interested,
        count(m.id) filter (where m.status in ('booked', 'hired'))::int as booked,
        count(m.id) filter (where m.status = 'hired')::int as hired
      from hiring_pushes p left join push_members m on m.push_id = p.id
      where p.tenant_id = ${tenantId} and ${day("p.created_at")} group by p.id order by p.created_at`),
    // offers recorded (risk hints saved then) by visits decided in the range, and how they ended
    db.execute<{ code: string; joined: number; dropped: number; pending: number }>(sql`
      select coalesce(h.code, 'none') as code,
        count(*) filter (where a.outcome = 'joined')::int as joined,
        count(*) filter (where a.outcome = 'offer_declined')::int as dropped,
        count(*) filter (where a.outcome = 'selected')::int as pending
      from applications a
      left join lateral unnest(case when cardinality(a.risk_hints) > 0 then a.risk_hints else array[null::text] end) as h(code) on true
      where a.tenant_id = ${tenantId} and a.risk_hints is not null and ${day("a.decided_at")}
      group by 1 order by 1`),
  ]);
  const catLabel = (c: string | null) => (c ? categoryOf(cats, c)!.label : "Not recorded");
  const totalWhy = [...whyRows].reduce((a, r) => a + n(r.n), 0);
  const acc = new Map([...sugAcc].map((r) => [r.tag, n(r.n)]));
  const dis = new Map([...sugDis].map((r) => [r.tag, n(r.n)]));
  const sugTags = [...new Set([...acc.keys(), ...dis.keys()])];
  const pushTotal = [...pushes].reduce((a, p) => ({ members: a.members + n(p.members), called: a.called + n(p.called), interested: a.interested + n(p.interested), booked: a.booked + n(p.booked), hired: a.hired + n(p.hired) }), { members: 0, called: 0, interested: 0, booked: 0, hired: 0 });
  const riskRows = [...risk];
  const withHints = riskRows.filter((r) => r.code !== "none");

  return (
    <div className="space-y-6" aria-label="Rediscovery reports">
      <h2 className="text-xl font-semibold">Rediscovery</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card space-y-3" aria-labelledby="why-h">
          <h3 id="why-h" className="text-lg font-semibold">Why we didn&apos;t hire</h3>
          <Table label="Why we didn't hire" head={["Category", "Visits", "Share"]} rows={[...whyRows].map((r) => [catLabel(r.cat), n(r.n), `${rate(n(r.n), totalWhy) ?? 0}%`])} />
          <p className="text-xs text-slate-500">Rejections, declined offers, no-shows and walk-aways decided in the period.</p>
        </section>
        <section className="card space-y-3" aria-labelledby="whypos-h">
          <h3 id="whypos-h" className="text-lg font-semibold">Why we didn&apos;t hire, by position</h3>
          <Table label="Why we didn't hire by position" head={["Position", "Category", "Visits"]} rows={[...byPos].map((r) => [r.job, catLabel(r.cat), n(r.n)])} />
        </section>
        <section className="card space-y-3" aria-labelledby="cost-h">
          <h3 id="cost-h" className="text-lg font-semibold">Cost gap</h3>
          {n(cost?.n) === 0 ? (
            <p className="text-sm text-slate-500">No cost decisions in this period.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-sm" data-testid="cost-gap">
              <dt className="text-slate-600">Cost decisions</dt><dd className="tabular-nums">{n(cost.n)}</dd>
              <dt className="text-slate-600">Average asked</dt><dd>{lpa(cost.expected)}</dd>
              <dt className="text-slate-600">Average budget / offer</dt><dd>{lpa(cost.budget)}</dd>
              <dt className="text-slate-600">Average gap</dt><dd>{cost.gap === null ? "—" : `+${Math.round(Number(cost.gap))}%`} ({n(cost.with_both)} with both figures)</dd>
              <dt className="text-slate-600">Budget not recorded</dt><dd className="tabular-nums">{n(cost.no_budget)}</dd>
            </dl>
          )}
        </section>
        <section className="card space-y-3" aria-labelledby="poolsize-h">
          <h3 id="poolsize-h" className="text-lg font-semibold">Pool size by tag (now)</h3>
          <Table label="Pool size by tag" head={["Tag", "People"]} rows={[...pool].map((r) => [tags.get(r.tag) ?? r.tag, n(r.n)])} />
        </section>
        <section className="card space-y-3" aria-labelledby="sug-h">
          <h3 id="sug-h" className="text-lg font-semibold">Suggestions accepted vs dismissed</h3>
          <Table label="Suggestions accepted vs dismissed" head={["Tag", "Accepted", "Dismissed"]} rows={sugTags.map((t) => [tags.get(t) ?? t, acc.get(t) ?? 0, dis.get(t) ?? 0])} />
        </section>
        <section className="card space-y-3" aria-labelledby="cb-h">
          <h3 id="cb-h" className="text-lg font-semibold">Call-backs</h3>
          <p className="text-sm" data-testid="callbacks-report">Due now: {n(cbNow?.due)} · planned: {n(cbNow?.upcoming)} · done in the period: {[...cbDone].reduce((a, r) => a + n(r.n), 0)}</p>
          <Table label="Call-back outcomes" head={["Outcome", "Done"]} rows={[...cbDone].map((r) => [CONTACT_OUTCOMES[r.outcome as keyof typeof CONTACT_OUTCOMES] ?? (r.outcome === "consent_withdrawn" ? "Consent withdrawn" : (r.outcome ?? "—")), n(r.n)])} />
        </section>
        <section className="card space-y-3 lg:col-span-2" aria-labelledby="push-h">
          <h3 id="push-h" className="text-lg font-semibold">Hiring push results</h3>
          {pushes.length === 0 ? (
            <p className="text-sm text-slate-500">No pushes saved in this period.</p>
          ) : (
            <>
              <p className="text-sm" data-testid="push-funnel">
                {pushTotal.members} on lists → called {pushTotal.called} → interested {pushTotal.interested} → booked {pushTotal.booked} → hired {pushTotal.hired}
              </p>
              <Table label="Push results" head={["Push", "On list", "Called", "Interested", "Booked", "Hired"]} rows={[...pushes].map((p) => [p.name, n(p.members), n(p.called), n(p.interested), n(p.booked), n(p.hired)])} />
            </>
          )}
        </section>
        <section className="card space-y-3 lg:col-span-2" aria-labelledby="risk-h">
          <h3 id="risk-h" className="text-lg font-semibold">Joining-risk hints vs what happened</h3>
          <Table
            label="Joining-risk hints vs outcome"
            head={["Hint when the offer was recorded", "Joined", "Dropped (declined)", "Still waiting"]}
            rows={riskRows.map((r) => [r.code === "none" ? "No hints" : (RISK_LABELS[r.code as RiskCode] ?? r.code), n(r.joined), n(r.dropped), n(r.pending)])}
          />
          <p className="text-xs text-slate-500">
            Offers recorded for visits decided in the period ({withHints.length ? "a person with two hints counts in both rows" : "no hints so far"}). If people with a hint drop out more often than people without, the hint is useful.
          </p>
        </section>
      </div>
    </div>
  );
}
