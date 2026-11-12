import type { Metadata } from "next";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { RediscoveryTabs } from "@/components/rediscovery-tabs";
import { formatDateIST } from "@/lib/ist";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Hiring pushes" };

export default async function PushesPage() {
  const staff = await requireStaff("rediscovery");
  const rows = await db.execute<{ id: string; name: string; created_at: string; members: number; called: number; interested: number; booked: number; hired: number }>(sql`
    select p.id, p.name, p.created_at,
      count(m.id)::int as members,
      count(m.id) filter (where m.status <> 'to_call')::int as called,
      count(m.id) filter (where m.status = 'interested')::int as interested,
      count(m.id) filter (where m.status = 'booked')::int as booked,
      count(m.id) filter (where m.status = 'hired')::int as hired
    from hiring_pushes p left join push_members m on m.push_id = p.id
    where p.tenant_id = ${staff.tenantId}
    group by p.id order by p.created_at desc`);
  return (
    <div className="space-y-6">
      <RediscoveryTabs />
      <div>
        <h1 className="text-2xl font-semibold">Hiring pushes</h1>
        <p className="mt-1 text-slate-600">Saved call lists from Bulk hiring, with their progress.</p>
      </div>
      {rows.length === 0 ? (
        <p className="card text-slate-600">
          No pushes yet. Build a list in <Link href="/dashboard/bulk" className="text-blue-700 underline">Bulk hiring</Link> and save it.
        </p>
      ) : (
        <ul className="space-y-2">
          {[...rows].map((r) => (
            <li key={r.id} className="card flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4">
              <Link href={`/dashboard/pushes/${r.id}`} className="text-lg font-semibold text-blue-800 underline">{r.name}</Link>
              <span className="text-sm text-slate-600">{formatDateIST(new Date(r.created_at))}</span>
              <span className="text-sm">{r.members} people · called {r.called} → interested {r.interested} → booked {r.booked} → hired {r.hired}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
