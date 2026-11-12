// Writes of Phase 3.6 (HR-only data). Each runs inside act() (one transaction + live ping) and writes an audit row
// with ids, codes and counts only. Every candidate id is checked against the staff member's tenant first.
import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { applications, callbacks, candidates, candidateTags, consents, contactLog, doNotContact, hiringPushes, optionItems, otherOffers, pushMembers, suggestionDismissals, tenants } from "@/db/schema";
import { FlowError, NotFoundError } from "@/lib/flow";
import { APP_UTC_OFFSET, todayIST } from "@/lib/ist";
import { getActiveNotice } from "@/lib/notice-db";
import { TAG } from "@/lib/rediscovery/categories";
import { whatsappAllowed, type Channel, type ConsentChannel, type ContactOutcome, type Purpose } from "@/lib/rediscovery/contact";
import { insights } from "@/lib/rediscovery/data";
import { bulkList, type BulkInput } from "@/lib/rediscovery/pool";
import type { PushStatus } from "@/lib/rediscovery/rank";
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

// ---------- contact, do not contact, call-backs, consent (sub-phase D) ----------

async function activeDnc(tx: Tx, staff: Staff, candidateId: string) {
  const [d] = await tx
    .select({ id: doNotContact.id })
    .from(doNotContact)
    .where(and(eq(doNotContact.tenantId, staff.tenantId), eq(doNotContact.candidateId, candidateId), isNull(doNotContact.clearedAt)));
  return d ?? null;
}

async function latestConsent(tx: Tx, staff: Staff, candidateId: string) {
  const [k] = await tx
    .select()
    .from(consents)
    .where(and(eq(consents.tenantId, staff.tenantId), eq(consents.candidateId, candidateId)))
    .orderBy(desc(consents.acceptedAt))
    .limit(1);
  return k ?? null;
}

export async function logContact(
  tx: Tx,
  staff: Staff,
  candidateId: string,
  input: { channel: Channel; purpose: Purpose; outcome: ContactOutcome | null; note: string | null; pushId?: string | null },
) {
  await lockCandidate(tx, staff, candidateId);
  if (await activeDnc(tx, staff, candidateId)) throw new FlowError("This person asked not to be contacted.");
  if (input.channel === "whatsapp" && !whatsappAllowed(await latestConsent(tx, staff, candidateId))) {
    throw new FlowError("No WhatsApp consent from this person: call only.");
  }
  if (input.pushId) {
    const [p] = await tx.select({ id: hiringPushes.id }).from(hiringPushes).where(and(eq(hiringPushes.id, input.pushId), eq(hiringPushes.tenantId, staff.tenantId)));
    if (!p) throw new NotFoundError("Hiring push not found.");
  }
  const [row] = await tx
    .insert(contactLog)
    .values({ tenantId: staff.tenantId, candidateId, channel: input.channel, purpose: input.purpose, outcome: input.outcome, note: input.note, pushId: input.pushId ?? null, contactedBy: staff.id })
    .returning({ id: contactLog.id });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "contact.log", entityType: "candidate", entityId: candidateId, meta: { contactId: row.id, channel: input.channel, purpose: input.purpose, outcome: input.outcome } });
}

export async function setDoNotContact(tx: Tx, staff: Staff, candidateId: string, reason: string) {
  await lockCandidate(tx, staff, candidateId);
  if (await activeDnc(tx, staff, candidateId)) throw new FlowError("Already marked Do not contact.");
  const [row] = await tx.insert(doNotContact).values({ tenantId: staff.tenantId, candidateId, reason, setBy: staff.id }).returning({ id: doNotContact.id });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "contact.block", entityType: "candidate", entityId: candidateId, meta: { dncId: row.id } });
}

/** Admin only (permission contactUnblock, checked by the API), with a note. */
export async function clearDoNotContact(tx: Tx, staff: Staff, candidateId: string, note: string) {
  await lockCandidate(tx, staff, candidateId);
  const d = await activeDnc(tx, staff, candidateId);
  if (!d) throw new FlowError("This person is not marked Do not contact.");
  await tx.update(doNotContact).set({ clearedAt: new Date(), clearedBy: staff.id, clearNote: note }).where(eq(doNotContact.id, d.id));
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "contact.unblock", entityType: "candidate", entityId: candidateId, meta: { dncId: d.id } });
}

export async function setCallback(tx: Tx, staff: Staff, candidateId: string, input: { dueOn: string; note: string | null }) {
  await lockCandidate(tx, staff, candidateId);
  const [last] = await tx
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.tenantId, staff.tenantId), eq(applications.candidateId, candidateId), isNotNull(applications.decidedAt)))
    .orderBy(desc(applications.decidedAt))
    .limit(1);
  const [onHold] = await tx
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.tenantId, staff.tenantId), eq(applications.candidateId, candidateId), eq(applications.outcome, "on_hold")))
    .limit(1);
  if (!last && !onHold) throw new FlowError("Call-backs can be set once the candidate has a decision.");
  if (await activeDnc(tx, staff, candidateId)) throw new FlowError("This person asked not to be contacted.");
  // one open call-back per person: setting a new date replaces the open one
  const [open] = await tx
    .select({ id: callbacks.id })
    .from(callbacks)
    .where(and(eq(callbacks.tenantId, staff.tenantId), eq(callbacks.candidateId, candidateId), eq(callbacks.status, "open")));
  let id: string;
  if (open) {
    await tx.update(callbacks).set({ dueOn: input.dueOn, note: input.note }).where(eq(callbacks.id, open.id));
    id = open.id;
  } else {
    [{ id }] = await tx
      .insert(callbacks)
      .values({ tenantId: staff.tenantId, candidateId, applicationId: (onHold ?? last)!.id, dueOn: input.dueOn, note: input.note, createdBy: staff.id })
      .returning({ id: callbacks.id });
  }
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: open ? "callback.update" : "callback.set", entityType: "candidate", entityId: candidateId, meta: { callbackId: id } });
}

async function openCallback(tx: Tx, staff: Staff, candidateId: string, callbackId: string) {
  const [cb] = await tx
    .select()
    .from(callbacks)
    .where(and(eq(callbacks.id, callbackId), eq(callbacks.tenantId, staff.tenantId), eq(callbacks.candidateId, candidateId)))
    .for("update");
  if (!cb) throw new NotFoundError("Call-back not found.");
  if (cb.status !== "open") throw new FlowError("This call-back is already done.");
  return cb;
}

export async function snoozeCallback(tx: Tx, staff: Staff, candidateId: string, input: { callbackId: string; dueOn: string; note: string | null }) {
  const cb = await openCallback(tx, staff, candidateId, input.callbackId);
  await tx.update(callbacks).set({ dueOn: input.dueOn, note: input.note ?? cb.note }).where(eq(callbacks.id, cb.id));
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "callback.snooze", entityType: "candidate", entityId: candidateId, meta: { callbackId: cb.id } });
}

export async function doneCallback(tx: Tx, staff: Staff, candidateId: string, input: { callbackId: string; outcome: ContactOutcome; note: string | null }) {
  const cb = await openCallback(tx, staff, candidateId, input.callbackId);
  await tx.update(callbacks).set({ status: "done", outcome: input.outcome, doneBy: staff.id, doneAt: new Date(), note: input.note ?? cb.note }).where(eq(callbacks.id, cb.id));
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "callback.done", entityType: "candidate", entityId: candidateId, meta: { callbackId: cb.id, outcome: input.outcome } });
}

/** Not-hired, decided visits of a candidate (the ones retention dates apply to). */
const notHired = (staff: Staff, candidateId: string) =>
  and(eq(applications.tenantId, staff.tenantId), eq(applications.candidateId, candidateId), inArray(applications.outcome, ["rejected", "no_show", "withdrawn", "offer_declined"]), isNotNull(applications.decidedAt));

/**
 * Talent-pool consent given after the visit (or renewed): a new consent row with the notice in use. The person is in
 * the pool from now on, so their not-hired visits lose their deletion dates (the keep period takes over).
 */
export async function recordConsent(tx: Tx, staff: Staff, candidateId: string, input: { day: string; channel: ConsentChannel; note: string | null; whatsapp: boolean }) {
  await lockCandidate(tx, staff, candidateId);
  const notice = await getActiveNotice(staff.tenantId);
  const acceptedAt = input.day === todayIST() ? new Date() : new Date(`${input.day}T12:00:00${APP_UTC_OFFSET}`);
  const [row] = await tx
    .insert(consents)
    .values({ tenantId: staff.tenantId, candidateId, noticeVersion: notice.version, noticeId: notice.id, language: "en", talentPool: true, whatsapp: input.whatsapp, acceptedAt, recordedBy: staff.id, channel: input.channel, note: input.note })
    .returning({ id: consents.id });
  const kept = await tx.update(applications).set({ purgeAfter: null, photoPurgeAfter: null }).where(notHired(staff, candidateId)).returning({ id: applications.id });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "consent.record", entityType: "candidate", entityId: candidateId, meta: { consentId: row.id, channel: input.channel, whatsapp: input.whatsapp, visitsKept: kept.length } });
}

/**
 * Withdrawal (one click, with its date): out of the pool, bulk lists and call-backs; normal retention restarts from
 * the withdrawal date for every not-hired visit (data and photo periods of the tenant).
 */
export async function withdrawConsent(tx: Tx, staff: Staff, candidateId: string, input: { day: string }) {
  await lockCandidate(tx, staff, candidateId);
  const k = await latestConsent(tx, staff, candidateId);
  if (!k || !k.talentPool || k.withdrawnAt) throw new FlowError("This person has no talent-pool consent to withdraw.");
  const at = input.day === todayIST() ? new Date() : new Date(`${input.day}T12:00:00${APP_UTC_OFFSET}`);
  await tx.update(consents).set({ withdrawnAt: at }).where(eq(consents.id, k.id));
  const [t] = await tx.select({ data: tenants.dataRetentionDays, photo: tenants.photoRetentionDays }).from(tenants).where(eq(tenants.id, staff.tenantId));
  const restarted = await tx
    .update(applications)
    .set({ purgeAfter: new Date(at.getTime() + t.data * 86_400_000), photoPurgeAfter: new Date(at.getTime() + t.photo * 86_400_000) })
    .where(notHired(staff, candidateId))
    .returning({ id: applications.id });
  const closed = await tx
    .update(callbacks)
    .set({ status: "done", outcome: "consent_withdrawn", doneBy: staff.id, doneAt: new Date() })
    .where(and(eq(callbacks.tenantId, staff.tenantId), eq(callbacks.candidateId, candidateId), eq(callbacks.status, "open")))
    .returning({ id: callbacks.id });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "consent.withdraw", entityType: "candidate", entityId: candidateId, meta: { consentId: k.id, visitsRestarted: restarted.length, callbacksClosed: closed.length } });
}

// ---------- hiring pushes (sub-phase E) ----------

/** At most this many people are saved in one push (the list is ranked, so these are the best ones). */
export const PUSH_MAX = 200;

/** Saves the bulk list as a named push. The list is rebuilt here from the criteria (never taken from the browser). */
export async function createPush(tx: Tx, staff: Staff, input: { name: string; criteria: BulkInput }) {
  const { rows } = await bulkList(staff.tenantId, input.criteria);
  if (!rows.length) throw new FlowError("Nobody matches these criteria, so there is nothing to save.");
  const take = rows.slice(0, PUSH_MAX);
  const [p] = await tx.insert(hiringPushes).values({ tenantId: staff.tenantId, name: input.name, criteria: input.criteria, createdBy: staff.id }).returning({ id: hiringPushes.id });
  await tx.insert(pushMembers).values(take.map((r, i) => ({ tenantId: staff.tenantId, pushId: p.id, candidateId: r.id, rank: i + 1, score: r.ranked.score, why: r.ranked.why, updatedBy: staff.id })));
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "push.create", entityType: "hiring_push", entityId: p.id, meta: { members: take.length, needed: input.criteria.needed } });
  return { id: p.id, members: take.length };
}

export async function setPushStatus(tx: Tx, staff: Staff, pushId: string, input: { memberId: string; status: PushStatus }) {
  const [m] = await tx
    .update(pushMembers)
    .set({ status: input.status, updatedBy: staff.id, updatedAt: new Date() })
    .where(and(eq(pushMembers.id, input.memberId), eq(pushMembers.pushId, pushId), eq(pushMembers.tenantId, staff.tenantId)))
    .returning({ id: pushMembers.id, candidateId: pushMembers.candidateId });
  if (!m) throw new NotFoundError("Not on this push.");
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "push.status", entityType: "hiring_push", entityId: pushId, meta: { memberId: m.id, candidateId: m.candidateId, status: input.status } });
}
