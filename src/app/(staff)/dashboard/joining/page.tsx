import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { applications, candidates, jobs } from "@/db/schema";
import { RediscoveryTabs } from "@/components/rediscovery-tabs";
import { formatDayIST } from "@/lib/ist";
import { formatLpa } from "@/lib/money";
import { OFFER_STATUS_LABELS } from "@/lib/options";
import { risksFor } from "@/lib/rediscovery/data";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Joining soon" };

// Selected / offered people who have not joined yet, with joining-risk hints (HR, manager, admin). Hints never change an outcome.
export default async function JoiningPage() {
  const staff = await requireStaff("rediscovery");
  const rows = await db
    .select({ id: applications.id, candidateId: candidates.id, name: candidates.fullName, mobile: candidates.mobile, job: jobs.title, offerStatus: applications.offerStatus, offeredCtc: applications.offeredCtc, joiningDate: applications.joiningDate })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.tenantId, staff.tenantId), eq(applications.outcome, "selected")))
    .orderBy(sql`${applications.joiningDate} asc nulls last`, asc(candidates.fullName));
  const risks = await risksFor(staff.tenantId, rows.map((r) => r.id));
  return (
    <div className="space-y-6">
      <RediscoveryTabs />
      <div>
        <h1 className="text-2xl font-semibold">Joining soon</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Selected and offered people who have not joined yet, earliest joining date first. Hints are only reasons to call and check; they never change a result.
          Turn each hint on or off in Settings → Rediscovery.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="card text-slate-600">Nobody is waiting to join.</p>
      ) : (
        <ul className="space-y-3" aria-label="Joining soon">
          {rows.map((r) => {
            const h = risks.get(r.id) ?? [];
            return (
              <li key={r.id} className="card space-y-1 p-4" aria-label={`Joining: ${r.name}`}>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/dashboard/candidates/${r.candidateId}`} className="text-lg font-semibold text-blue-800 underline">{r.name}</Link>
                  <span className="text-slate-600">{r.mobile} · {r.job}</span>
                </p>
                <p className="text-sm text-slate-700">
                  {r.offerStatus ? `Offer ${OFFER_STATUS_LABELS[r.offerStatus].toLowerCase()}` : "Selected, no offer recorded"}
                  {r.offeredCtc !== null && ` at ${formatLpa(r.offeredCtc)}`}
                  {r.joiningDate ? ` · joining ${formatDayIST(r.joiningDate)}` : " · no joining date"}
                </p>
                {h.length ? (
                  <ul className="list-disc pl-5 text-sm text-amber-900" data-testid="risk-hints">
                    {h.map((x) => <li key={x.code}>{x.text}</li>)}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-600" data-testid="risk-hints">No risk hints</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
