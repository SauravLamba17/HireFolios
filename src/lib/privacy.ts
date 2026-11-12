// Rights requests (DPDP): log, track, and act — access (ZIP), correction (edit), erasure (same code as the
// deletion job), grievance (notes only). Audit rows hold ids and codes only.
import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { db, type Tx } from "@/db";
import { applications, candidateFiles, candidates, consents, dsrRequests, jobs, queueEvents, scorecards, stages } from "@/db/schema";
import { searchTextFor } from "@/lib/candidate-search";
import { extensionOf, readFileUnder, uploadRoot } from "@/lib/files";
import { FlowError, NotFoundError } from "@/lib/flow";
import { eraseCandidateRows } from "@/lib/purge";
import { APP_UTC_OFFSET } from "@/lib/ist";
import { dsrDueAt } from "@/lib/retention";
import type { Staff } from "@/lib/session";
import { audit } from "@/lib/staff";

export async function createRequest(
  tx: Tx,
  staff: Staff,
  input: { kind: "access" | "correction" | "erasure" | "grievance"; mobile: string | null; requesterName: string; requesterContact: string | null; receivedOn: string; notes: string | null },
) {
  let candidateId: string | null = null;
  if (input.mobile) {
    const [c] = await tx.select({ id: candidates.id }).from(candidates).where(and(eq(candidates.tenantId, staff.tenantId), eq(candidates.mobile, input.mobile)));
    if (!c) throw new FlowError("No candidate with that mobile number. Leave it empty to log the request without one.");
    candidateId = c.id;
  }
  const receivedAt = new Date(`${input.receivedOn}T12:00:00${APP_UTC_OFFSET}`);
  const [row] = await tx
    .insert(dsrRequests)
    .values({
      tenantId: staff.tenantId,
      candidateId,
      kind: input.kind,
      requestedAt: receivedAt,
      dueAt: dsrDueAt(receivedAt),
      requesterName: input.requesterName,
      requesterContact: input.requesterContact,
      notes: input.notes,
      createdBy: staff.id,
    })
    .returning({ id: dsrRequests.id });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "dsr.create", entityType: "dsr_request", entityId: row.id, meta: { kind: input.kind, candidateId } });
  return row.id;
}

async function lockRequest(tx: Tx, staff: Staff, id: string) {
  const [r] = await tx.select().from(dsrRequests).where(and(eq(dsrRequests.id, id), eq(dsrRequests.tenantId, staff.tenantId))).for("update");
  if (!r) throw new NotFoundError("Request not found");
  return r;
}

export async function updateRequest(tx: Tx, staff: Staff, id: string, input: { status: "open" | "in_progress" | "completed" | "rejected"; resolution: string | null }) {
  const r = await lockRequest(tx, staff, id);
  const closed = input.status === "completed" || input.status === "rejected";
  await tx
    .update(dsrRequests)
    .set({ status: input.status, resolution: input.resolution, resolvedAt: closed ? (r.resolvedAt ?? new Date()) : null, handledBy: staff.id })
    .where(eq(dsrRequests.id, id));
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "dsr.update", entityType: "dsr_request", entityId: id, meta: { status: input.status } });
}

/** Erasure request → delete the candidate now (same deletion code as the retention job). Returns file keys to unlink after commit. */
export async function eraseForRequest(tx: Tx, staff: Staff, id: string): Promise<string[]> {
  const r = await lockRequest(tx, staff, id);
  if (r.kind !== "erasure") throw new FlowError("Only erasure requests can erase data.");
  if (!r.candidateId) throw new FlowError("This request has no candidate (already erased, or none linked).");
  const joined = await tx.$count(applications, and(eq(applications.candidateId, r.candidateId), eq(applications.outcome, "joined")));
  if (joined) throw new FlowError("This person joined as an employee. Handle their records through HR, not here.");
  const candidateId = r.candidateId;
  const keys = await eraseCandidateRows(tx, staff.tenantId, candidateId);
  await tx
    .update(dsrRequests)
    .set({ status: "completed", resolvedAt: new Date(), handledBy: staff.id, resolution: r.resolution ?? "Erased all data and files." })
    .where(eq(dsrRequests.id, id));
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "candidate.erase", entityType: "candidate", entityId: candidateId, meta: { requestId: id, files: keys.length } });
  return keys;
}

/** Access request → ZIP of everything held about the candidate: data.json plus photos and CV files. */
export async function accessZip(staff: Staff, id: string): Promise<{ zip: Uint8Array; name: string }> {
  const [r] = await db.select().from(dsrRequests).where(and(eq(dsrRequests.id, id), eq(dsrRequests.tenantId, staff.tenantId)));
  if (!r) throw new NotFoundError("Request not found");
  if (!r.candidateId) throw new FlowError("This request has no candidate linked.");
  const t = staff.tenantId;
  const cid = r.candidateId;
  const [c] = await db.select().from(candidates).where(and(eq(candidates.id, cid), eq(candidates.tenantId, t)));
  if (!c) throw new NotFoundError("Candidate not found");
  const [visits, consentRows, files, rounds, events] = await Promise.all([
    db
      .select({
        token: applications.token,
        day: applications.tokenDate,
        position: jobs.title,
        stage: stages.name,
        outcome: applications.outcome,
        rejectReason: applications.rejectReason,
        source: applications.source,
        decidedAt: applications.decidedAt,
        offerStatus: applications.offerStatus,
        offeredCtc: applications.offeredCtc,
        joiningDate: applications.joiningDate,
        joinedOn: applications.joinedOn,
        deleteDataAfter: applications.purgeAfter,
        deletePhotoAfter: applications.photoPurgeAfter,
      })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(stages, eq(stages.id, applications.currentStageId))
      .where(and(eq(applications.tenantId, t), eq(applications.candidateId, cid)))
      .orderBy(asc(applications.createdAt)),
    db
      .select({ acceptedAt: consents.acceptedAt, noticeVersion: consents.noticeVersion, language: consents.language, talentPool: consents.talentPool, whatsapp: consents.whatsapp, withdrawnAt: consents.withdrawnAt })
      .from(consents)
      .where(and(eq(consents.tenantId, t), eq(consents.candidateId, cid))),
    db
      .select({ id: candidateFiles.id, kind: candidateFiles.kind, key: candidateFiles.storageKey, type: candidateFiles.mimeType, pageNo: candidateFiles.pageNo })
      .from(candidateFiles)
      .where(and(eq(candidateFiles.tenantId, t), eq(candidateFiles.candidateId, cid), sql`${candidateFiles.deletedAt} is null`)),
    db
      .select({ stage: stages.name, scores: scorecards.scores, overall: scorecards.overall, decision: scorecards.decision, rejectReason: scorecards.rejectReason, notes: scorecards.comments, at: scorecards.updatedAt })
      .from(scorecards)
      .innerJoin(applications, eq(applications.id, scorecards.applicationId))
      .innerJoin(stages, eq(stages.id, scorecards.stageId))
      .where(and(eq(applications.tenantId, t), eq(applications.candidateId, cid))),
    db
      .select({ event: queueEvents.event, stage: stages.name, at: queueEvents.createdAt })
      .from(queueEvents)
      .innerJoin(applications, eq(applications.id, queueEvents.applicationId))
      .leftJoin(stages, eq(stages.id, queueEvents.stageId))
      .where(and(eq(applications.tenantId, t), eq(applications.candidateId, cid), ne(queueEvents.event, "returned"))),
  ]);
  const { searchText: _s, tenantId: _t, ...profile } = c;
  void _s;
  void _t;
  const data = {
    exportedAt: new Date().toISOString(),
    note: "Everything this recruitment system holds about you. Money is in rupees per year. Times are UTC (ISO 8601).",
    profile,
    visits,
    interviewRounds: rounds,
    queueHistory: events,
    consents: consentRows,
    files: files.map((f) => ({ file: `files/${f.kind}-${f.pageNo ?? 1}-${f.id.slice(0, 8)}.${extensionOf(f.type)}`, kind: f.kind })),
  };
  const out: Record<string, Uint8Array> = { "data.json": strToU8(JSON.stringify(data, null, 2)) };
  const root = uploadRoot();
  for (const [i, f] of files.entries()) {
    const bytes = root ? await readFileUnder(root, f.key).catch(() => null) : null;
    if (bytes) out[data.files[i].file] = new Uint8Array(bytes);
  }
  await audit(db, { tenantId: t, actorUserId: staff.id, action: "dsr.access_export", entityType: "dsr_request", entityId: id, meta: { candidateId: cid, files: files.length } });
  return { zip: zipSync(out, { level: 6 }), name: `data-request-${id.slice(0, 8)}.zip` };
}

/** Correction request → edit the core details (search text and audit updated; audit lists field names only). */
export async function correctCandidate(
  tx: Tx,
  staff: Staff,
  id: string,
  input: { fullName: string; mobile: string; email: string | null; city: string; dateOfBirth: string },
) {
  const [c] = await tx.select().from(candidates).where(and(eq(candidates.id, id), eq(candidates.tenantId, staff.tenantId))).for("update");
  if (!c) throw new NotFoundError("Candidate not found");
  const changed = (["fullName", "mobile", "email", "city", "dateOfBirth"] as const).filter((k) => (c[k] ?? null) !== (input[k] ?? null));
  if (!changed.length) return;
  const next = { ...c, ...input };
  await tx
    .update(candidates)
    .set({ ...input, searchText: searchTextFor({ ...next, qualification: c.qualification }), updatedAt: new Date() })
    .where(eq(candidates.id, id));
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "candidate.correct", entityType: "candidate", entityId: id, meta: { fields: changed.join(",") } });
}
