import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { formatDateTimeIST, formatDayIST, todayIST } from "@/lib/ist";
import { barWidths, fillDays, minutesLabel, parseRange, rate } from "@/lib/reports";
import { can, requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Reports" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const JOINED_EXPORT = "/api/exports/joined";
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function Bars({ rows, label, valueLabel }: { rows: { name: string; n: number; extra?: string }[]; label: string; valueLabel?: (n: number) => string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">No data in this period.</p>;
  return (
    <ul className="space-y-2" aria-label={label}>
      {barWidths(rows).map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(8rem,14rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={r.name}>{r.name}</span>
          <span className="h-4 rounded bg-slate-100">
            <span className="block h-4 rounded bg-blue-600" style={{ width: `${r.pct}%` }} />
          </span>
          <span className="tabular-nums">
            {valueLabel ? valueLabel(r.n) : r.n}
            {r.extra && <span className="text-slate-500"> · {r.extra}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Walk-ins per day: a plain SVG bar chart (works offline). */
function DayChart({ days }: { days: { day: string; n: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  const w = 900;
  const h = 180;
  const bw = w / days.length;
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h + 24}`} role="img" aria-label="Walk-ins per day" className="h-auto w-full">
        {days.map((d, i) => {
          const bh = (d.n / max) * h;
          return (
            <g key={d.day}>
              <title>{`${formatDayIST(d.day)}: ${d.n}`}</title>
              <rect x={i * bw + 2} y={h - bh} width={Math.max(1, bw - 4)} height={bh} rx={2} className="fill-blue-600" />
              {(i === 0 || i === days.length - 1 || days.length <= 14) && (
                <text x={i * bw + bw / 2} y={h + 16} textAnchor="middle" className="fill-slate-500 text-[11px]">
                  {d.day.slice(8)}/{d.day.slice(5, 7)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="text-sm text-slate-600">Busiest day: {max === 1 && days.every((d) => d.n === 0) ? "—" : `${max} walk-ins`}</figcaption>
    </figure>
  );
}

export default async function ReportsPage({ searchParams }: Props) {
  const staff = await requireStaff("reports");
  const p = await searchParams;
  const { from, to } = parseRange({ from: one(p.from), to: one(p.to) }, todayIST());
  const t = staff.tenantId;
  const inRange = sql`a.tenant_id = ${t} and a.token_date between ${from}::date and ${to}::date`;
  const asOf = new Date();

  const [[tiles], [wait], perDay, funnel, sources, positions, reasons, load] = await Promise.all([
    db.execute<Record<string, number | null>>(sql`
      select count(*)::int as walkins, count(distinct a.candidate_id)::int as unique_candidates,
             count(*) filter (where a.outcome in ('selected','joined','offer_declined'))::int as selected,
             count(*) filter (where a.outcome = 'joined')::int as joined,
             count(*) filter (where a.outcome = 'rejected')::int as rejected,
             count(*) filter (where a.outcome = 'no_show')::int as no_show,
             avg(extract(epoch from (a.decided_at - a.created_at)) / 60) filter (where a.decided_at is not null)::float as decision_min
      from applications a where ${inRange}`),
    // Waiting time: from joining the queue for a round (or registering) to being called into a room.
    db.execute<{ avg: number | null; n: number }>(sql`
      select avg(extract(epoch from (e.created_at - coalesce(
               (select max(q.created_at) from queue_events q where q.application_id = e.application_id
                  and q.event in ('queued', 'returned') and q.created_at <= e.created_at), a.created_at))) / 60)::float as avg,
             count(*)::int as n
      from queue_events e join applications a on a.id = e.application_id
      where ${inRange} and e.event = 'called'`),
    db.execute<{ day: string; n: number }>(sql`select a.token_date::text as day, count(*)::int as n from applications a where ${inRange} group by 1`),
    db.execute<{ name: string; position: number; n: number }>(sql`
      select s.name, s.position, count(distinct e.application_id)::int as n
      from stages s
      left join queue_events e on e.stage_id = s.id and e.event = 'called'
        and e.application_id in (select a.id from applications a where ${inRange})
      where s.tenant_id = ${t} and s.active and s.is_interview
      group by s.id, s.name, s.position order by s.position`),
    db.execute<{ name: string; n: number }>(sql`select coalesce(a.source, 'Not recorded') as name, count(*)::int as n from applications a where ${inRange} group by 1 order by 2 desc`),
    db.execute<{ name: string; n: number; selected: number }>(sql`
      select j.title as name, count(*)::int as n, count(*) filter (where a.outcome in ('selected','joined','offer_declined'))::int as selected
      from applications a join jobs j on j.id = a.job_id where ${inRange} group by 1 order by 2 desc`),
    db.execute<{ name: string; n: number }>(sql`
      select a.reject_reason as name, count(*)::int as n from applications a
      where ${inRange} and a.outcome = 'rejected' and a.reject_reason is not null group by 1 order by 2 desc limit 10`),
    db.execute<{ name: string; n: number; passed: number; avg: number | null }>(sql`
      select u.name, count(*)::int as n,
             count(*) filter (where sc.decision = 'pass')::int as passed,
             avg(extract(epoch from (c.created_at - (select max(k.created_at) from queue_events k
                  where k.application_id = c.application_id and k.event = 'called' and k.created_at <= c.created_at))) / 60)::float as avg
      from queue_events c
      join applications a on a.id = c.application_id
      join users u on u.id = c.interviewer_id
      left join scorecards sc on sc.application_id = c.application_id and sc.stage_id = c.stage_id and sc.interviewer_id = c.interviewer_id
      where ${inRange} and c.event = 'completed' and c.interviewer_id is not null
      group by u.name order by 2 desc`),
  ]);

  const walkins = num(tiles.walkins) ?? 0;
  const days = fillDays(from, to, [...perDay]);
  const tileList: [string, string][] = [
    ["Walk-ins", String(walkins)],
    ["Unique candidates", String(tiles.unique_candidates ?? 0)],
    ["Selected", `${tiles.selected ?? 0}${rate(num(tiles.selected) ?? 0, walkins) !== null ? ` (${rate(num(tiles.selected) ?? 0, walkins)}%)` : ""}`],
    ["Joined", String(tiles.joined ?? 0)],
    ["Rejected", String(tiles.rejected ?? 0)],
    ["No-show", String(tiles.no_show ?? 0)],
    ["Average wait", minutesLabel(num(wait.avg))],
    ["Walk-in → decision", minutesLabel(num(tiles.decision_min))],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="mt-1 text-slate-600">
            {formatDayIST(from)} – {formatDayIST(to)} · data as of {formatDateTimeIST(asOf)} IST
          </p>
        </div>
        {can(staff.role, "export") && (
          <div className="flex flex-wrap gap-2">
            {/* File downloads, not pages: plain links (next/link would prefetch the download). */}
            <a href={`${JOINED_EXPORT}`} download className="btn btn-secondary">Joined employees (Excel)</a>
            <a href={`${JOINED_EXPORT}?format=csv`} download className="btn btn-secondary">(CSV)</a>
          </div>
        )}
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3" aria-label="Date range">
        <div>
          <label htmlFor="from" className="label">From</label>
          <input id="from" name="from" type="date" defaultValue={from} max={todayIST()} className="input" />
        </div>
        <div>
          <label htmlFor="to" className="label">To</label>
          <input id="to" name="to" type="date" defaultValue={to} max={todayIST()} className="input" />
        </div>
        <button type="submit" className="btn btn-primary">Show</button>
      </form>

      {walkins === 0 ? (
        <p className="card text-center text-slate-600">No walk-ins between {formatDayIST(from)} and {formatDayIST(to)}.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Totals">
            {tileList.map(([k, v]) => (
              <div key={k} className="card p-4">
                <dt className="text-sm text-slate-600">{k}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums" data-testid={`tile-${k}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-500">
            Average wait: registering or finishing a round until called into a room ({wait.n} calls). Walk-in → decision: registering until the final result.
          </p>

          <section className="card space-y-3" aria-labelledby="day-h">
            <h2 id="day-h" className="text-lg font-semibold">Walk-ins per day</h2>
            <DayChart days={days} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card space-y-3" aria-labelledby="funnel-h">
              <h2 id="funnel-h" className="text-lg font-semibold">Stage funnel</h2>
              <Bars
                label="Stage funnel"
                rows={[
                  { name: "Registered", n: walkins },
                  ...[...funnel].map((f) => ({ name: f.name, n: Number(f.n), extra: `${rate(Number(f.n), walkins) ?? 0}%` })),
                  { name: "Selected", n: num(tiles.selected) ?? 0, extra: `${rate(num(tiles.selected) ?? 0, walkins) ?? 0}%` },
                  { name: "Joined", n: num(tiles.joined) ?? 0, extra: `${rate(num(tiles.joined) ?? 0, walkins) ?? 0}%` },
                ]}
              />
              <p className="text-xs text-slate-500">Rounds count walk-ins called into a room for that round.</p>
            </section>
            <section className="card space-y-3" aria-labelledby="src-h">
              <h2 id="src-h" className="text-lg font-semibold">How they heard about us</h2>
              <Bars label="Sources" rows={[...sources].map((s) => ({ name: s.name, n: Number(s.n) }))} />
            </section>
            <section className="card space-y-3" aria-labelledby="pos-h">
              <h2 id="pos-h" className="text-lg font-semibold">Selection rate by position</h2>
              <Bars
                label="Selection rate by position"
                rows={[...positions].map((r) => ({ name: r.name, n: Number(r.n), extra: `${Number(r.selected)} selected (${rate(Number(r.selected), Number(r.n)) ?? 0}%)` }))}
              />
            </section>
            <section className="card space-y-3" aria-labelledby="rej-h">
              <h2 id="rej-h" className="text-lg font-semibold">Top reject reasons</h2>
              <Bars label="Top reject reasons" rows={[...reasons].map((r) => ({ name: r.name, n: Number(r.n) }))} />
            </section>
          </div>

          <section className="card space-y-3 overflow-x-auto" aria-labelledby="load-h">
            <h2 id="load-h" className="text-lg font-semibold">Interviewer load</h2>
            {load.length === 0 ? (
              <p className="text-sm text-slate-500">No interviews finished in this period.</p>
            ) : (
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Interviewer</th>
                    <th className="py-2 pr-4 font-medium">Interviews</th>
                    <th className="py-2 pr-4 font-medium">Passed</th>
                    <th className="py-2 font-medium">Average length</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...load].map((r) => (
                    <tr key={r.name}>
                      <td className="py-2 pr-4">{r.name}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.n}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.passed} ({rate(Number(r.passed), Number(r.n)) ?? 0}%)</td>
                      <td className="py-2">{minutesLabel(num(r.avg))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
