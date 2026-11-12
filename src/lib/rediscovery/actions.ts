// Writes of Phase 3.6 (HR-only data). Each runs inside act() (one transaction + live ping) and writes an audit row
// with ids, codes and counts only. Every candidate id is checked against the staff member's tenant first.
import "server-only";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { applications, candidates, candidateTags, optionItems, otherOffers, suggestionDismissals } from "@/db/schema";
import { FlowError, NotFoundError } from "@/lib/flow";
import { TAG } from "@/lib/rediscovery/categories";
import { insights } from "@/lib/rediscovery/data";
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

// ---------- tags and suggestions (sub-phase B) ----------

/** The tag must be an active rediscovery tag of this tenant. */
async function checkTag(tx: Tx, staff: Staff, code: string) {
  const [t] = await tx
    .select({ id: optionItems.id })
    .from(optionItems)
    .where(and(eq(optionItems.tenantId, staff.tenantId), eq(optionItems.list, "rediscovery_tag"), eq(optionItems.code, code), eq(optionItems.active, true)));
  if (!t) throw new FlowError("Choose a tag from the list.");
}

/** Tags go on candidates who have a decided visit (never before the first decision). */
async function checkDecided(tx: Tx, staff: Staff, candidateId: string) {
  const [d] = await tx
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.tenantId, staff.tenantId), eq(applications.candidateId, candidateId), isNotNull(applications.decidedAt)))
    .limit(1);
  if (!d) throw new FlowError("Tags can be added once the candidate has a decision.");
}

export async function addTag(tx: Tx, staff: Staff, candidateId: string, input: { code: string; note: string | null; source?: "manual" | "suggestion" }) {
  await lockCandidate(tx, staff, candidateId);
  await checkTag(tx, staff, input.code);
  await checkDecided(tx, staff, candidateId);
  if (input.code === TAG.doNotRehire && !input.note) throw new FlowError("Do not rehire needs a reason.");
  const [have] = await tx
    .select({ id: candidateTags.id })
    .from(candidateTags)
    .where(and(eq(candidateTags.candidateId, candidateId), eq(candidateTags.tagCode, input.code), isNull(candidateTags.removedAt)));
  if (have) throw new FlowError("The candidate already has this tag.");
  const [row] = await tx
    .insert(candidateTags)
    .values({ tenantId: staff.tenantId, candidateId, tagCode: input.code, note: input.note, source: input.source ?? "manual", addedBy: staff.id })
    .returning({ id: candidateTags.id });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "tag.add", entityType: "candidate", entityId: candidateId, meta: { tag: input.code, source: input.source ?? "manual", tagId: row.id } });
}

export async function removeTag(tx: Tx, staff: Staff, candidateId: string, input: { tagId: string; note: string }) {
  await lockCandidate(tx, staff, candidateId);
  const [row] = await tx
    .update(candidateTags)
    .set({ removedAt: new Date(), removedBy: staff.id, removeNote: input.note })
    .where(and(eq(candidateTags.id, input.tagId), eq(candidateTags.tenantId, staff.tenantId), eq(candidateTags.candidateId, candidateId), isNull(candidateTags.removedAt)))
    .returning({ code: candidateTags.tagCode });
  if (!row) throw new NotFoundError("Tag not found.");
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "tag.remove", entityType: "candidate", entityId: candidateId, meta: { tag: row.code, tagId: input.tagId } });
}

/** The open suggestion for this tag, re-checked on the server (the page may be stale). */
async function openSuggestion(staff: Staff, candidateId: string, tag: string) {
  const found = (await insights(staff.tenantId, [candidateId])).get(candidateId)?.suggestions.find((s) => s.tag === tag);
  if (!found) throw new FlowError("That suggestion is no longer open (a new decision or a tag changed it). Refresh the page.");
  return found;
}

export async function acceptSuggestion(tx: Tx, staff: Staff, candidateId: string, input: { tag: string; note: string | null }) {
  await lockCandidate(tx, staff, candidateId);
  const s = await openSuggestion(staff, candidateId, input.tag);
  await addTag(tx, staff, candidateId, { code: s.tag, note: input.note ?? s.reason, source: "suggestion" });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "suggestion.accept", entityType: "candidate", entityId: candidateId, meta: { tag: s.tag, applicationId: s.applicationId } });
}

/** Remembered for this decision only: the suggestion returns after a new decision. */
export async function dismissSuggestion(tx: Tx, staff: Staff, candidateId: string, input: { tag: string; note: string | null }) {
  await lockCandidate(tx, staff, candidateId);
  const s = await openSuggestion(staff, candidateId, input.tag);
  await tx.insert(suggestionDismissals).values({
    tenantId: staff.tenantId,
    candidateId,
    tagCode: s.tag,
    applicationId: s.applicationId,
    // the decision's own timestamp, copied exactly (a new decision changes it)
    decidedAt: sql`(select decided_at from applications where id = ${s.applicationId})`,
    note: input.note,
    dismissedBy: staff.id,
  });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "suggestion.dismiss", entityType: "candidate", entityId: candidateId, meta: { tag: s.tag, applicationId: s.applicationId } });
}
