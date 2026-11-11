import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, users } from "@/db/schema";
import { AUDIT_PAGE, auditRows, auditWhere, parseAuditFilters } from "@/lib/audit-query";
import { formatDateTimeIST, todayIST } from "@/lib/ist";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Audit log" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Who did what, when. Rows hold ids and codes only (never names, mobiles or emails of candidates).
export default async function AuditPage({ searchParams }: Props) {
  const staff = await requireStaff("audit");
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const f = parseAuditFilters(raw);
  const [rows, [{ n }], actions, people] = await Promise.all([
    auditRows(staff.tenantId, f, AUDIT_PAGE, (f.page - 1) * AUDIT_PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(auditWhere(staff.tenantId, f)),
    db.selectDistinct({ action: auditLog.action }).from(auditLog).where(eq(auditLog.tenantId, staff.tenantId)).orderBy(asc(auditLog.action)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.tenantId, staff.tenantId)).orderBy(asc(users.name)),
  ]);
  const qs = (patch: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ from: f.from, to: f.to, action: f.action, actor: f.actor, page: f.page, ...patch })) if (v !== null && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    return p.toString();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <p className="mt-1 text-slate-600">{n} {n === 1 ? "entry" : "entries"} · ids and codes only</p>
        </div>
        <a href={`/api/audit/export?${qs({ page: null })}`} className="btn btn-secondary">Export CSV</a>
      </div>
      <form method="get" className="card grid gap-3 md:grid-cols-5 md:items-end" aria-label="Filter the audit log">
        <div>
          <label htmlFor="from" className="label">From</label>
          <input id="from" name="from" type="date" defaultValue={f.from} max={todayIST()} className="input" />
        </div>
        <div>
          <label htmlFor="to" className="label">To</label>
          <input id="to" name="to" type="date" defaultValue={f.to} max={todayIST()} className="input" />
        </div>
        <div>
          <label htmlFor="action" className="label">Action</label>
          <select id="action" name="action" defaultValue={f.action ?? ""} className="input">
            <option value="">Any</option>
            {actions.map((a) => <option key={a.action}>{a.action}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="actor" className="label">Done by</label>
          <select id="actor" name="actor" defaultValue={f.actor ?? ""} className="input">
            <option value="">Anyone</option>
            <option value="system">System (automatic jobs)</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">Filter</button>
      </form>
      {rows.length === 0 ? (
        <p className="card text-center text-slate-600">No entries for these filters.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">When (IST)</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Done by</th>
                <th className="px-3 py-2 font-medium">Record</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeIST(r.at)}</td>
                  <td className="px-3 py-2 font-mono">{r.action}</td>
                  <td className="px-3 py-2">{r.actor ?? (r.actorId ? "(removed user)" : "System")}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.entityType}
                    {r.entityId && <> · {r.entityType === "candidate" ? <Link href={`/dashboard/candidates/${r.entityId}`} className="text-blue-800 underline">{r.entityId}</Link> : r.entityId}</>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs break-all">{r.meta ? JSON.stringify(r.meta) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {n > AUDIT_PAGE && (
        <nav className="flex items-center justify-between" aria-label="Pages">
          {f.page > 1 ? <Link href={`/dashboard/audit?${qs({ page: f.page - 1 })}`} className="btn btn-secondary">← Newer</Link> : <span />}
          <span className="text-slate-600">Page {f.page} of {Math.ceil(n / AUDIT_PAGE)}</span>
          {f.page * AUDIT_PAGE < n ? <Link href={`/dashboard/audit?${qs({ page: f.page + 1 })}`} className="btn btn-secondary">Older →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
