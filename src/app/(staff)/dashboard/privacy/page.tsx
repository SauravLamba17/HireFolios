import type { Metadata } from "next";
import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { candidates, dsrRequests } from "@/db/schema";
import { formatDateIST, formatDateTimeIST, todayIST } from "@/lib/ist";
import { dsrOverdue } from "@/lib/retention";
import { requireStaff } from "@/lib/session";
import { KINDS, NewRequest, RequestActions } from "./privacy-actions";

export const metadata: Metadata = { title: "Privacy requests" };

const STATUS: Record<string, string> = { open: "Open", in_progress: "In progress", completed: "Completed", rejected: "Rejected" };

// Rights requests under the DPDP Act: log each one, answer within 90 days, act from here.
export default async function PrivacyPage() {
  const staff = await requireStaff("privacy");
  const rows = await db
    .select({ r: dsrRequests, name: candidates.fullName, candidateId: candidates.id })
    .from(dsrRequests)
    .leftJoin(candidates, eq(candidates.id, dsrRequests.candidateId))
    .where(eq(dsrRequests.tenantId, staff.tenantId))
    .orderBy(asc(dsrRequests.status), desc(dsrRequests.requestedAt));
  const now = new Date();
  const overdue = rows.filter((x) => dsrOverdue(x.r, now)).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Privacy requests</h1>
        <p className="mt-1 text-slate-600">
          When a candidate asks to see, correct or delete their data, or complains about how it was used, log it here and answer within 90 days.
          {overdue > 0 && <strong className="text-red-800"> {overdue} overdue.</strong>}
        </p>
      </div>
      <NewRequest today={todayIST()} />
      <section className="space-y-3" aria-labelledby="list-h">
        <h2 id="list-h" className="text-lg font-semibold">Requests ({rows.length})</h2>
        {rows.length === 0 && <p className="card text-slate-600">No requests logged.</p>}
        <ul className="space-y-3">
          {rows.map(({ r, name, candidateId }) => {
            const late = dsrOverdue(r, now);
            return (
              <li key={r.id} className={`card space-y-3 p-4 ${late ? "border-red-300 bg-red-50/40" : ""}`} aria-label={`${KINDS[r.kind as keyof typeof KINDS] ?? r.kind} from ${r.requesterName ?? "unknown"}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <strong>{KINDS[r.kind as keyof typeof KINDS] ?? r.kind}</strong>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm">{STATUS[r.status]}</span>
                  {late && <span className="rounded-full bg-red-700 px-2.5 py-0.5 text-sm font-medium text-white">Overdue</span>}
                  <span className="text-sm text-slate-600">
                    from {r.requesterName ?? "—"}
                    {r.requesterContact && ` (${r.requesterContact})`} · received {formatDateIST(r.requestedAt)} · due {r.dueAt ? formatDateIST(r.dueAt) : "—"}
                    {r.resolvedAt && ` · closed ${formatDateTimeIST(r.resolvedAt)}`}
                  </span>
                </div>
                <p className="text-sm">
                  Candidate:{" "}
                  {candidateId ? (
                    <Link href={`/dashboard/candidates/${candidateId}`} className="text-blue-800 underline">
                      {name}
                    </Link>
                  ) : (
                    <span className="text-slate-500">{r.status === "completed" && r.kind === "erasure" ? "erased" : "not linked"}</span>
                  )}
                  {r.kind === "correction" && candidateId && <span className="text-slate-600"> · open the profile and use &ldquo;Correct details&rdquo;</span>}
                </p>
                {r.notes && <p className="whitespace-pre-line text-sm text-slate-700">{r.notes}</p>}
                <RequestActions id={r.id} kind={r.kind} status={r.status} resolution={r.resolution} hasCandidate={Boolean(candidateId)} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
