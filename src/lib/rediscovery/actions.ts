// Writes of Phase 3.6 (HR-only data). Each runs inside act() (one transaction + live ping) and writes an audit row
// with ids, codes and counts only. Every candidate id is checked against the staff member's tenant first.
import "server-only";
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { candidates, otherOffers } from "@/db/schema";
import { NotFoundError } from "@/lib/flow";
import type { Staff } from "@/lib/session";
import { audit } from "@/lib/staff";

/** The candidate, locked, if it belongs to this tenant (another tenant's id answers 404 like a missing one). */
export async function lockCandidate(tx: Tx, staff: Staff, candidateId: string) {
  const [c] = await tx
    .select({ id: candidates.id, noticeDays: candidates.noticeDays })
    .from(candidates)
    .where(and(eq(candidates.id, candidateId), eq(candidates.tenantId, staff.tenantId)))
    .for("update");
  if (!c) throw new NotFoundError("Candidate not found.");
  return c;
}

export async function addOtherOffer(
  tx: Tx,
  staff: Staff,
  candidateId: string,
  o: { company: string | null; offeredCtc: number | null; joiningDate: string | null; notedOn: string },
) {
  await lockCandidate(tx, staff, candidateId);
  const [row] = await tx
    .insert(otherOffers)
    .values({ tenantId: staff.tenantId, candidateId, company: o.company, offeredCtc: o.offeredCtc, joiningDate: o.joiningDate, notedOn: o.notedOn, createdBy: staff.id })
    .returning({ id: otherOffers.id });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "other_offer.add", entityType: "candidate", entityId: candidateId, meta: { otherOfferId: row.id } });
}
