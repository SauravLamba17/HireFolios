import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, isUuid } from "@/db";
import { candidates, hiringPushes, jobs, pushMembers, users } from "@/db/schema";
import { PersonContact } from "@/components/person-contact";
import { RediscoveryTabs } from "@/components/rediscovery-tabs";
import { getCompany } from "@/lib/company";
import { formatDateTimeIST } from "@/lib/ist";
import { contactStates } from "@/lib/rediscovery/data";
import { PUSH_STATUSES, type PushStatus } from "@/lib/rediscovery/rank";
import { bulkQuery, BulkForm } from "@/lib/rediscovery/pool";
import { getSettings } from "@/lib/rediscovery/settings-db";
import { can, requireStaff } from "@/lib/session";
import { StatusSelect } from "./status-select";

export const metadata: Metadata = { title: "Hiring push" };

export default async function PushPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("rediscovery");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [p] = await db
    .select({ id: hiringPushes.id, name: hiringPushes.name, criteria: hiringPushes.criteria, createdAt: hiringPushes.createdAt, by: users.name })
    .from(hiringPushes)
    .leftJoin(users, eq(users.id, hiringPushes.createdBy))
    .where(and(eq(hiringPushes.id, id), eq(hiringPushes.tenantId, staff.tenantId)));
  if (!p) notFound();
  const members = await db
    .select({ id: pushMembers.id, candidateId: pushMembers.candidateId, status: pushMembers.status, rank: pushMembers.rank, score: pushMembers.score, why: pushMembers.why, name: candidates.fullName, mobile: candidates.mobile, city: candidates.city })
    .from(pushMembers)
    .innerJoin(candidates, eq(candidates.id, pushMembers.candidateId))
    .where(and(eq(pushMembers.pushId, id), eq(pushMembers.tenantId, staff.tenantId)))
    .orderBy(asc(pushMembers.rank));
  const criteria = BulkForm.parse(p.criteria);
  const [states, settings, company, jobRows] = await Promise.all([
    contactStates(staff.tenantId, members.map((m) => m.candidateId)),
    getSettings(staff.tenantId),
    getCompany(staff.tenantId),
    criteria.jobs.length ? db.select({ title: jobs.title }).from(jobs).where(and(eq(jobs.tenantId, staff.tenantId), inArray(jobs.id, criteria.jobs))) : Promise.resolve([]),
  ]);
  const position = jobRows.map((j) => j.title).join(" / ");
  const count = (s: PushStatus) => members.filter((m) => m.status === s).length;
  const called = members.length - count("to_call");

  return (
    <div className="space-y-6">
      <RediscoveryTabs />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p><Link href="/dashboard/pushes" className="text-blue-700 underline">← All pushes</Link></p>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          <p className="text-slate-600">
            Saved {formatDateTimeIST(p.createdAt)} by {p.by ?? "—"} · {criteria.needed} needed{criteria.budget !== undefined && ` · budget ${criteria.budget} LPA`}
            {position && ` · ${position}`} · <Link href={`/dashboard/bulk?${bulkQuery(criteria)}`} className="text-blue-700 underline">rebuild this list</Link>
          </p>
        </div>
        {can(staff.role, "export") && <a href={`/api/exports/push?id=${p.id}`} className="btn btn-secondary">Export to Excel</a>}
      </div>
      <section className="card" aria-label="Progress">
        <p className="flex flex-wrap gap-x-6 gap-y-1 text-base" data-testid="push-progress">
          <span>{members.length} on the list</span>
          <span>Called {called}</span>
          {(Object.keys(PUSH_STATUSES) as PushStatus[]).filter((s) => s !== "to_call").map((s) => (
            <span key={s}>{PUSH_STATUSES[s]} {count(s)}</span>
          ))}
        </p>
      </section>
      <ol className="space-y-2" aria-label="People on this push">
        {members.map((m) => (
          <li key={m.id} className="card flex flex-wrap items-start gap-3 p-3" aria-label={`Push: ${m.name}`}>
            <span className="w-10 text-lg font-semibold text-slate-500">#{m.rank}</span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/dashboard/candidates/${m.candidateId}`} className="font-semibold text-blue-800 underline">{m.name}</Link>
                <span className="text-sm text-slate-600">{m.mobile}{m.city ? ` · ${m.city}` : ""} · score {m.score}</span>
              </p>
              <p className="text-sm text-slate-700">{m.why}</p>
              <PersonContact
                person={{ id: m.candidateId, name: m.name, mobile: m.mobile }}
                state={states.get(m.candidateId)!}
                settings={settings}
                company={company.shortName}
                hrName={staff.name}
                position={position}
                purpose="bulk_push"
                pushId={p.id}
                withCallback={false}
              />
            </div>
            <StatusSelect pushId={p.id} memberId={m.id} value={m.status} name={m.name} />
          </li>
        ))}
      </ol>
    </div>
  );
}
