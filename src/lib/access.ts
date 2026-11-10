// Who may open a candidate's profile and files. Interviewers: only candidates who were ever called to a
// panel they sat on. Everyone with the "candidates" permission: all candidates of their tenant.
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { mayViewCandidate } from "@/lib/flow";
import { can, type Staff } from "@/lib/session";

export async function interviewedBy(staff: Staff, candidateId: string) {
  const rows = await db.execute(sql`
    select 1 from queue_events e join applications a on a.id = e.application_id
    where a.tenant_id = ${staff.tenantId} and a.candidate_id = ${candidateId}
      and e.event = 'called' and e.interviewer_id = ${staff.id}
    limit 1`);
  return rows.length > 0;
}

export async function canViewCandidate(staff: Staff, candidateId: string) {
  if (can(staff.role, "candidates")) return true;
  if (!can(staff.role, "interview")) return false;
  return mayViewCandidate(false, await interviewedBy(staff, candidateId));
}
