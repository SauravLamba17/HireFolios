// Drive day: today's drive per location, its panels (rooms), the queue and every move on it.
// Each action runs in one transaction and writes queue_events + audit_log (ids and codes only);
// callers publish a change ping (src/lib/live.ts) after it commits.
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { applications, consents, drives, locations, panels, queueEvents, rejectReasons, scorecards, stages, tenants, users } from "@/db/schema";
import { applyDecision, canMarkJoined, FlowError, NotFoundError, offerOutcome, outcomeDates, pickNext, queueOrder, queueStage, waitEstimate, type Decision, type OfferStatus, type Outcome, type StageInfo } from "@/lib/flow";
import { todayIST } from "@/lib/ist";
import { audit } from "@/lib/staff";
import type { Staff } from "@/lib/session";

export { FlowError as DriveError };

type Q = typeof db | Tx;

export async function stageList(q: Q, tenantId: string) {
  return q
    .select({ id: stages.id, name: stages.name, position: stages.position, active: stages.active, isInterview: stages.isInterview, criteria: stages.criteria })
    .from(stages)
    .where(eq(stages.tenantId, tenantId))
    .orderBy(asc(stages.position));
}

/**
 * Today's drive for the tenant's location, created on first use. Also tidies the day: panels left open on
 * an earlier day are closed (their candidates go back to waiting) and today's walk-ins are attached.
 */
export async function todayDrive(q: Q, tenantId: string) {
  const day = todayIST();
  const [loc] = await q
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.active, true)))
    .orderBy(asc(locations.createdAt))
    .limit(1);
  if (!loc) throw new FlowError("No location is set up. Ask your admin.");
  await q
    .insert(drives)
    .values({ tenantId, locationId: loc.id, driveDate: day, name: `Walk-in drive ${day}` })
    .onConflictDoNothing({ target: [drives.tenantId, drives.locationId, drives.driveDate] });
  const [drive] = await q
    .select()
    .from(drives)
    .where(and(eq(drives.tenantId, tenantId), eq(drives.locationId, loc.id), eq(drives.driveDate, day)));

  const stale = await q
    .update(panels)
    .set({ status: "closed" })
    .where(and(eq(panels.tenantId, tenantId), ne(panels.status, "closed"), sql`${panels.driveId} is distinct from ${drive.id}`))
    .returning({ id: panels.id });
  for (const p of stale) await releasePanel(q, tenantId, p.id, null, "panel closed (earlier day)");
  await q
    .update(applications)
    .set({ driveId: drive.id })
    .where(and(eq(applications.tenantId, tenantId), eq(applications.tokenDate, day), isNull(applications.driveId), eq(applications.outcome, "in_progress")));
  return { ...drive, locationName: loc.name };
}

/** Sends whoever sits at this panel back to the waiting list without a decision (keeps their place). */
async function releasePanel(q: Q, tenantId: string, panelId: string, actorId: string | null, note: string) {
  const freed = await q
    .update(applications)
    .set({ panelId: null })
    .where(and(eq(applications.tenantId, tenantId), eq(applications.panelId, panelId)))
    .returning({ id: applications.id, stageId: applications.currentStageId });
  for (const a of freed) {
    await q.insert(queueEvents).values({ tenantId, applicationId: a.id, stageId: a.stageId, panelId, event: "returned", actorUserId: actorId, note });
  }
  return freed.length;
}

async function talentPool(q: Q, tenantId: string, candidateId: string) {
  const [k] = await q
    .select({ pool: consents.talentPool, withdrawn: consents.withdrawnAt })
    .from(consents)
    .where(and(eq(consents.tenantId, tenantId), eq(consents.candidateId, candidateId)))
    .orderBy(desc(consents.acceptedAt))
    .limit(1);
  return Boolean(k?.pool && !k.withdrawn);
}

async function tenantRetention(q: Q, tenantId: string) {
  const [t] = await q
    .select({ dataRetentionDays: tenants.dataRetentionDays, photoRetentionDays: tenants.photoRetentionDays, avg: tenants.avgInterviewMinutes })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return t;
}

// ---------- reading the board ----------

// Raw SQL rows (db.execute) carry timestamps as strings; turn them into Dates once, here.
const toDate = <T extends string | Date | null>(v: T) => (v === null ? null : new Date(v)) as T extends null ? null : Date;

type AppRow = {
  id: string;
  token: string;
  token_date: string;
  candidate_id: string;
  full_name: string;
  job: string;
  current_stage_id: string;
  panel_id: string | null;
  outcome: Outcome;
  reject_reason: string | null;
  created_at: Date;
  decided_at: Date | null;
  queued_at: Date | null;
  last_event_at: Date | null;
  called_at: Date | null;
  photo_id: string | null;
  cooldown: boolean;
  duplicate: boolean;
};

export async function boardState(tenantId: string) {
  const drive = await todayDrive(db, tenantId);
  const [stageRows, panelRows, appRows, timing, t] = await Promise.all([
    stageList(db, tenantId),
    db
      .select({ id: panels.id, name: panels.name, stageId: panels.stageId, status: panels.status, interviewerId: panels.interviewerId, interviewer: users.name })
      .from(panels)
      .leftJoin(users, eq(users.id, panels.interviewerId))
      .where(and(eq(panels.tenantId, tenantId), eq(panels.driveId, drive.id), ne(panels.status, "closed")))
      .orderBy(asc(panels.name)),
    db.execute<AppRow>(sql`
      select a.id, a.token, a.token_date::text, c.id as candidate_id, c.full_name, j.title as job, a.current_stage_id, a.panel_id,
             a.outcome, a.reject_reason, a.created_at, a.decided_at,
             (select max(e.created_at) from queue_events e where e.application_id = a.id and e.event = 'queued') as queued_at,
             (select max(e.created_at) from queue_events e where e.application_id = a.id) as last_event_at,
             (select max(e.created_at) from queue_events e where e.application_id = a.id and e.event = 'called') as called_at,
             (select f.id from candidate_files f where f.candidate_id = c.id and f.tenant_id = a.tenant_id and f.kind = 'photo'
                and f.deleted_at is null order by f.created_at desc limit 1) as photo_id,
             exists (select 1 from applications r join tenants tt on tt.id = r.tenant_id
                     where r.candidate_id = c.id and r.id <> a.id and r.outcome = 'rejected'
                       and r.token_date + tt.cooldown_days > a.token_date) as cooldown,
             exists (select 1 from candidates d where d.tenant_id = c.tenant_id and d.id <> c.id
                     and ((c.email is not null and d.email = c.email)
                       or (d.date_of_birth = c.date_of_birth and similarity(d.full_name, c.full_name) >= 0.5))) as duplicate
      from applications a
      join candidates c on c.id = a.candidate_id
      join jobs j on j.id = a.job_id
      where a.tenant_id = ${tenantId} and a.drive_id = ${drive.id}`),
    // Finished interviews today: each "completed" paired with the "called" before it.
    db.execute<{ n: number; avg: number | null }>(sql`
      select count(*)::int as n, avg(extract(epoch from (c.created_at - k.called_at)) / 60)::float as avg
      from queue_events c
      join applications a on a.id = c.application_id
      cross join lateral (select max(e.created_at) as called_at from queue_events e
                          where e.application_id = c.application_id and e.event = 'called' and e.created_at <= c.created_at) k
      where c.tenant_id = ${tenantId} and a.drive_id = ${drive.id} and c.event = 'completed' and k.called_at is not null`),
    tenantRetention(db, tenantId),
  ]);
  const apps = [...appRows].map((a) => ({
    ...a,
    created_at: toDate(a.created_at),
    decided_at: toDate(a.decided_at),
    queued_at: toDate(a.queued_at),
    last_event_at: toDate(a.last_event_at),
    called_at: toDate(a.called_at),
  }));
  const finishedToday = timing[0]?.n ?? 0;
  const averageToday = timing[0]?.avg ?? null;
  const stageName = new Map(stageRows.map((s) => [s.id, s.name]));
  const info: StageInfo[] = stageRows;

  const inInterview = panelRows.map((p) => {
    const a = apps.find((x) => x.panel_id === p.id && x.outcome === "in_progress");
    return { ...p, stage: stageName.get(p.stageId) ?? "?", current: a ? { ...a, calledAt: a.called_at } : null };
  });

  const waitingAll = apps
    .filter((a) => a.outcome === "in_progress" && !a.panel_id)
    .map((a) => ({ ...a, queueStageId: queueStage(info, a.current_stage_id)?.id ?? null, queuedAt: a.queued_at ?? a.created_at, waitingSince: a.last_event_at ?? a.created_at }));
  const interviewStages = stageRows.filter((s) => s.active && s.isInterview);
  const waiting = interviewStages.map((s) => {
    const list = waitingAll
      .filter((w) => w.queueStageId === s.id)
      .map((w) => ({ applicationId: w.id, queuedAt: w.queuedAt, token: w.token, row: w }))
      .sort(queueOrder);
    const working = panelRows.filter((p) => p.stageId === s.id && (p.status === "available" || p.status === "busy")).length;
    return {
      stage: s,
      panels: working,
      cards: list.map((c, i) => ({
        ...c.row,
        position: i + 1,
        estimate: waitEstimate({ position: i + 1, panels: working, finishedToday, averageToday, defaultMinutes: t.avg }),
      })),
    };
  });
  // Waiting for no active round (e.g. moved to "Offer" by an override): listed so nobody gets lost.
  const unqueued = waitingAll.filter((w) => !w.queueStageId);

  const done = apps.filter((a) => a.outcome !== "in_progress").sort((a, b) => (b.decided_at?.getTime() ?? 0) - (a.decided_at?.getTime() ?? 0));
  return { drive, stages: stageRows, panels: inInterview, waiting, unqueued, done, finishedToday, averageToday, defaultMinutes: t.avg };
}

export type Board = Awaited<ReturnType<typeof boardState>>;

/** Last calls for the lobby screen: token and room only (no names). */
export async function lobbyState(tenantId: string) {
  const drive = await todayDrive(db, tenantId);
  const calls = await db
    .select({ id: queueEvents.id, token: applications.token, room: panels.name, at: queueEvents.createdAt })
    .from(queueEvents)
    .innerJoin(applications, eq(applications.id, queueEvents.applicationId))
    .innerJoin(panels, eq(panels.id, queueEvents.panelId))
    .where(and(eq(queueEvents.tenantId, tenantId), eq(applications.driveId, drive.id), eq(queueEvents.event, "called")))
    .orderBy(desc(queueEvents.createdAt))
    .limit(5);
  const waiting = await db.$count(
    applications,
    and(eq(applications.tenantId, tenantId), eq(applications.driveId, drive.id), eq(applications.outcome, "in_progress"), isNull(applications.panelId)),
  );
  return { drive, calls, waiting };
}

// ---------- actions ----------

async function openDrive(tx: Tx, staff: Staff) {
  const drive = await todayDrive(tx, staff.tenantId);
  if (drive.closedAt) throw new FlowError("Today's drive is closed. Reopen it first.");
  return drive;
}

async function lockPanel(tx: Tx, staff: Staff, panelId: string, driveId: string) {
  const [p] = await tx
    .select()
    .from(panels)
    .where(and(eq(panels.id, panelId), eq(panels.tenantId, staff.tenantId), eq(panels.driveId, driveId), ne(panels.status, "closed")))
    .for("update");
  if (!p) throw new NotFoundError("That panel is not on today's board.");
  return p;
}

async function checkInterviewer(tx: Tx, staff: Staff, interviewerId: string, driveId: string, exceptPanelId?: string) {
  const [u] = await tx
    .select({ role: users.role, active: users.active })
    .from(users)
    .where(and(eq(users.id, interviewerId), eq(users.tenantId, staff.tenantId)));
  if (!u?.active || !["interviewer", "manager", "admin"].includes(u.role)) throw new FlowError("Choose an active interviewer, manager or admin.");
  const [other] = await tx
    .select({ name: panels.name })
    .from(panels)
    .where(and(eq(panels.tenantId, staff.tenantId), eq(panels.driveId, driveId), eq(panels.interviewerId, interviewerId), ne(panels.status, "closed"), exceptPanelId ? ne(panels.id, exceptPanelId) : undefined));
  if (other) throw new FlowError(`That person already sits in ${other.name} today.`);
}

async function checkInterviewStage(tx: Tx, staff: Staff, stageId: string) {
  const [s] = await tx.select().from(stages).where(and(eq(stages.id, stageId), eq(stages.tenantId, staff.tenantId)));
  if (!s?.active || !s.isInterview) throw new FlowError("Choose an active interview round.");
}

export async function addPanel(tx: Tx, staff: Staff, input: { name: string; interviewerId: string; stageId: string }) {
  const drive = await openDrive(tx, staff);
  await checkInterviewStage(tx, staff, input.stageId);
  await checkInterviewer(tx, staff, input.interviewerId, drive.id);
  const [existing] = await tx.select().from(panels).where(and(eq(panels.tenantId, staff.tenantId), eq(panels.name, input.name))).for("update");
  const values = { driveId: drive.id, interviewerId: input.interviewerId, stageId: input.stageId, status: "available" as const, active: true, locationId: drive.locationId };
  let id: string;
  if (existing) {
    if (existing.driveId === drive.id && existing.status !== "closed") throw new FlowError(`${input.name} is already on today's board.`);
    await tx.update(panels).set(values).where(eq(panels.id, existing.id)); // a room used on an earlier day
    id = existing.id;
  } else {
    [{ id }] = await tx.insert(panels).values({ ...values, tenantId: staff.tenantId, name: input.name }).returning({ id: panels.id });
  }
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "panel.open", entityType: "panel", entityId: id, meta: { driveId: drive.id, stageId: input.stageId, interviewerId: input.interviewerId } });
  return id;
}

export async function updatePanel(
  tx: Tx,
  staff: Staff,
  input: { panelId: string; status?: "available" | "away" | "closed"; interviewerId?: string; stageId?: string },
) {
  const drive = await todayDrive(tx, staff.tenantId);
  const p = await lockPanel(tx, staff, input.panelId, drive.id);
  const changing = (input.interviewerId && input.interviewerId !== p.interviewerId) || (input.stageId && input.stageId !== p.stageId);
  if (changing && p.status === "busy") throw new FlowError("Finish or return the current candidate before changing this panel.");
  if (input.stageId) await checkInterviewStage(tx, staff, input.stageId);
  if (input.interviewerId) await checkInterviewer(tx, staff, input.interviewerId, drive.id, p.id);
  let returned = 0;
  if (input.status && input.status !== "available" && p.status === "busy") {
    // Panel goes away / closes mid-interview: the candidate goes back to waiting, keeping their place.
    returned = await releasePanel(tx, staff.tenantId, p.id, staff.id, input.status === "away" ? "panel went away" : "panel closed");
  }
  const status = input.status ?? p.status;
  await tx
    .update(panels)
    .set({ status, interviewerId: input.interviewerId ?? p.interviewerId, stageId: input.stageId ?? p.stageId })
    .where(eq(panels.id, p.id));
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "panel.update", entityType: "panel", entityId: p.id, meta: { status, returned } });
  return { returned };
}

/** Interviewer sets their own panel available / away (not while a candidate is with them). */
export async function setMyStatus(tx: Tx, staff: Staff, status: "available" | "away") {
  const drive = await todayDrive(tx, staff.tenantId);
  const [p] = await tx
    .select()
    .from(panels)
    .where(and(eq(panels.tenantId, staff.tenantId), eq(panels.driveId, drive.id), eq(panels.interviewerId, staff.id), ne(panels.status, "closed")))
    .for("update");
  if (!p) throw new FlowError("You are not on a panel today. Ask HR to add you.");
  if (p.status === "busy") throw new FlowError("Finish the current interview first.");
  await tx.update(panels).set({ status }).where(eq(panels.id, p.id));
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "panel.update", entityType: "panel", entityId: p.id, meta: { status, by: "interviewer" } });
}

/**
 * "Assign next" (no applicationId) or a manual pick. The panel row is locked, and the application is taken
 * only if it is still free (plus a unique index on applications.panel_id), so two people pressing at the
 * same moment can never put one candidate in two rooms.
 */
export async function assign(tx: Tx, staff: Staff, panelId: string, applicationId?: string) {
  const drive = await openDrive(tx, staff);
  const p = await lockPanel(tx, staff, panelId, drive.id);
  if (p.status !== "available") throw new FlowError(`${p.name} is ${p.status === "busy" ? "already with a candidate" : "away"}.`);
  if (!p.interviewerId) throw new FlowError(`${p.name} has no interviewer.`);
  const info = await stageList(tx, staff.tenantId);
  const rows = await tx
    .select({ id: applications.id, token: applications.token, stageId: applications.currentStageId, createdAt: applications.createdAt })
    .from(applications)
    .where(and(eq(applications.tenantId, staff.tenantId), eq(applications.driveId, drive.id), eq(applications.outcome, "in_progress"), isNull(applications.panelId)));
  const queued = await tx.execute<{ application_id: string; at: Date }>(sql`
    select e.application_id, max(e.created_at) as at from queue_events e
    join applications x on x.id = e.application_id
    where e.tenant_id = ${staff.tenantId} and x.drive_id = ${drive.id} and e.event = 'queued' group by e.application_id`);
  const queuedAt = new Map([...queued].map((r) => [r.application_id, toDate(r.at)]));
  let candidates = rows
    .filter((r) => queueStage(info, r.stageId)?.id === p.stageId)
    .map((r) => ({ applicationId: r.id, token: r.token, queuedAt: queuedAt.get(r.id) ?? r.createdAt }));
  if (applicationId) {
    candidates = candidates.filter((c) => c.applicationId === applicationId);
    if (!candidates.length) throw new FlowError("That candidate is not waiting for this round any more.");
  }
  while (candidates.length) {
    const next = pickNext(candidates)!;
    const [taken] = await tx
      .update(applications)
      .set({ panelId: p.id, currentStageId: p.stageId })
      .where(and(eq(applications.id, next.applicationId), isNull(applications.panelId), eq(applications.outcome, "in_progress")))
      .returning({ id: applications.id, token: applications.token });
    if (taken) {
      await tx.update(panels).set({ status: "busy" }).where(eq(panels.id, p.id));
      await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: taken.id, stageId: p.stageId, panelId: p.id, event: "called", actorUserId: staff.id, interviewerId: p.interviewerId });
      await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "queue.assign", entityType: "application", entityId: taken.id, meta: { panelId: p.id, stageId: p.stageId, manual: Boolean(applicationId) } });
      return { token: taken.token, room: p.name };
    }
    candidates = candidates.filter((c) => c.applicationId !== next.applicationId); // taken by another panel a moment ago
  }
  throw new FlowError(applicationId ? "That candidate was just assigned elsewhere." : "Nobody is waiting for this round.");
}

async function lockApplication(tx: Tx, staff: Staff, applicationId: string) {
  const [a] = await tx
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.tenantId, staff.tenantId)))
    .for("update");
  if (!a) throw new NotFoundError("Candidate visit not found.");
  return a;
}

async function freePanelOf(tx: Tx, panelId: string | null) {
  if (panelId) await tx.update(panels).set({ status: "available" }).where(and(eq(panels.id, panelId), eq(panels.status, "busy")));
}

/** Back to waiting from a panel, without a decision. */
export async function requeue(tx: Tx, staff: Staff, applicationId: string) {
  const a = await lockApplication(tx, staff, applicationId);
  if (!a.panelId || a.outcome !== "in_progress") throw new FlowError("That candidate is not in an interview.");
  await tx.update(applications).set({ panelId: null }).where(eq(applications.id, a.id));
  await freePanelOf(tx, a.panelId);
  await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: a.id, stageId: a.currentStageId, panelId: a.panelId, event: "returned", actorUserId: staff.id, note: "returned to waiting by HR" });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "queue.return", entityType: "application", entityId: a.id, meta: { panelId: a.panelId } });
}

/** Sets an outcome with its dates, frees the panel and logs it. */
async function setOutcome(tx: Tx, staff: Staff, a: typeof applications.$inferSelect, outcome: Outcome, stageId: string, rejectReason: string | null) {
  const t = await tenantRetention(tx, staff.tenantId);
  const dates = outcomeDates(outcome, new Date(), t, await talentPool(tx, staff.tenantId, a.candidateId));
  await tx
    .update(applications)
    .set({ outcome, currentStageId: stageId, rejectReason: outcome === "rejected" ? rejectReason : null, panelId: null, ...dates })
    .where(eq(applications.id, a.id));
  await freePanelOf(tx, a.panelId);
}

export async function markGone(tx: Tx, staff: Staff, applicationId: string, kind: "no_show" | "withdrawn") {
  const a = await lockApplication(tx, staff, applicationId);
  if (a.outcome !== "in_progress") throw new FlowError("That candidate already has a result.");
  await setOutcome(tx, staff, a, kind, a.currentStageId, null);
  await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: a.id, stageId: a.currentStageId, panelId: a.panelId, event: "skipped", actorUserId: staff.id, note: kind === "no_show" ? "no show" : "walked away" });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "application.outcome", entityType: "application", entityId: a.id, meta: { outcome: kind } });
}

export async function endDay(tx: Tx, staff: Staff, reopen: boolean) {
  const drive = await todayDrive(tx, staff.tenantId);
  if (reopen) {
    await tx.update(drives).set({ closedAt: null, closedBy: null }).where(eq(drives.id, drive.id));
  } else {
    if (drive.closedAt) throw new FlowError("Today's drive is already closed.");
    const open = await tx
      .update(panels)
      .set({ status: "closed" })
      .where(and(eq(panels.tenantId, staff.tenantId), eq(panels.driveId, drive.id), ne(panels.status, "closed")))
      .returning({ id: panels.id });
    for (const p of open) await releasePanel(tx, staff.tenantId, p.id, staff.id, "end of day");
    await tx.update(drives).set({ closedAt: new Date(), closedBy: staff.id }).where(eq(drives.id, drive.id));
  }
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: reopen ? "drive.reopen" : "drive.close", entityType: "drive", entityId: drive.id });
}

// ---------- interview decision ----------

export async function decide(
  tx: Tx,
  staff: Staff,
  input: { applicationId: string; scores: Record<string, number>; notes: string | null; decision: Decision; rejectReason: string | null },
) {
  const a = await lockApplication(tx, staff, input.applicationId);
  if (!a.panelId || a.outcome !== "in_progress") throw new FlowError("This candidate is no longer in your interview.");
  const [p] = await tx.select().from(panels).where(and(eq(panels.id, a.panelId), eq(panels.tenantId, staff.tenantId))).for("update");
  if (!p || p.interviewerId !== staff.id) throw new FlowError("This candidate is no longer in your interview.");

  const info = await stageList(tx, staff.tenantId);
  const stage = info.find((s) => s.id === a.currentStageId)!;
  const labels = stage.criteria.map((c) => c.label);
  for (const [k, v] of Object.entries(input.scores)) {
    if (!labels.includes(k)) throw new FlowError(`Unknown criterion: ${k}`);
    if (!Number.isInteger(v) || v < 1 || v > 5) throw new FlowError("Scores are 1 to 5.");
  }
  const missing = stage.criteria.filter((c) => c.required && input.scores[c.label] === undefined).map((c) => c.label);
  if (missing.length) throw new FlowError(`Rate the required criteria: ${missing.join(", ")}.`);
  if (input.decision === "reject") {
    const [ok] = await tx
      .select({ id: rejectReasons.id })
      .from(rejectReasons)
      .where(and(eq(rejectReasons.tenantId, staff.tenantId), eq(rejectReasons.label, input.rejectReason ?? ""), eq(rejectReasons.active, true)));
    if (!ok) throw new FlowError("Choose a reject reason from the list.");
  }
  const move = applyDecision(info, a.currentStageId, input.decision, input.rejectReason);

  const values = Object.values(input.scores);
  const overall = values.length ? Math.round(values.reduce((x, y) => x + y, 0) / values.length) : null;
  const card = {
    scores: input.scores,
    overall,
    decision: input.decision,
    rejectReason: move.rejectReason,
    comments: input.notes,
    panelId: p.id,
    updatedAt: new Date(),
  };
  await tx
    .insert(scorecards)
    .values({ tenantId: staff.tenantId, applicationId: a.id, stageId: a.currentStageId, interviewerId: staff.id, ...card })
    .onConflictDoUpdate({ target: [scorecards.applicationId, scorecards.stageId, scorecards.interviewerId], set: card });

  await setOutcome(tx, staff, a, move.outcome, move.stageId, move.rejectReason);
  await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: a.id, stageId: a.currentStageId, panelId: p.id, event: "completed", actorUserId: staff.id, interviewerId: staff.id });
  if (move.outcome === "in_progress") {
    await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: a.id, stageId: move.stageId, event: "queued", actorUserId: staff.id });
  }
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "interview.decision", entityType: "application", entityId: a.id, meta: { stageId: a.currentStageId, decision: input.decision, outcome: move.outcome, nextStageId: move.stageId } });
  return move;
}

// ---------- profile: override and resume ----------

export async function override(
  tx: Tx,
  staff: Staff,
  input: { applicationId: string; reason: string } & ({ kind: "stage"; stageId: string } | { kind: "outcome"; outcome: Outcome; rejectReason: string | null }),
) {
  const a = await lockApplication(tx, staff, input.applicationId);
  const info = await stageList(tx, staff.tenantId);
  if (input.kind === "stage") {
    if (!info.some((s) => s.id === input.stageId)) throw new FlowError("Choose a stage.");
    const drive = await todayDrive(tx, staff.tenantId);
    await setOutcome(tx, staff, a, "in_progress", input.stageId, null);
    await tx.update(applications).set({ driveId: drive.id }).where(eq(applications.id, a.id)); // back on today's board
    await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: a.id, stageId: input.stageId, event: "queued", actorUserId: staff.id, note: `Override: ${input.reason}` });
  } else {
    if (input.outcome === "rejected") {
      const [ok] = await tx
        .select({ id: rejectReasons.id })
        .from(rejectReasons)
        .where(and(eq(rejectReasons.tenantId, staff.tenantId), eq(rejectReasons.label, input.rejectReason ?? ""), eq(rejectReasons.active, true)));
      if (!ok) throw new FlowError("Choose a reject reason from the list.");
    }
    if (input.outcome === "in_progress") {
      const drive = await todayDrive(tx, staff.tenantId);
      await tx.update(applications).set({ driveId: drive.id }).where(eq(applications.id, a.id));
    }
    await setOutcome(tx, staff, a, input.outcome, a.currentStageId, input.rejectReason);
    await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: a.id, stageId: a.currentStageId, panelId: a.panelId, event: input.outcome === "in_progress" ? "queued" : "completed", actorUserId: staff.id, note: `Override: ${input.reason}` });
  }
  await audit(tx, {
    tenantId: staff.tenantId,
    actorUserId: staff.id,
    action: "application.override",
    entityType: "application",
    entityId: a.id,
    meta: input.kind === "stage" ? { fromStageId: a.currentStageId, toStageId: input.stageId } : { fromOutcome: a.outcome, toOutcome: input.outcome },
  });
}

export async function resume(tx: Tx, staff: Staff, applicationId: string) {
  const a = await lockApplication(tx, staff, applicationId);
  if (a.outcome !== "on_hold") throw new FlowError("Only candidates on hold can be resumed.");
  const drive = await todayDrive(tx, staff.tenantId);
  await setOutcome(tx, staff, a, "in_progress", a.currentStageId, null);
  await tx.update(applications).set({ driveId: drive.id }).where(eq(applications.id, a.id));
  await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: a.id, stageId: a.currentStageId, event: "queued", actorUserId: staff.id, note: "resumed from hold" });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "application.resume", entityType: "application", entityId: a.id });
}

// ---------- offer and joining (profile) ----------

export async function recordOffer(
  tx: Tx,
  staff: Staff,
  applicationId: string,
  input: { status: OfferStatus; offeredCtc: number | null; joiningDate: string | null },
) {
  const a = await lockApplication(tx, staff, applicationId);
  const next = offerOutcome(a.outcome as Outcome, input.status);
  if (next !== a.outcome) await setOutcome(tx, staff, a, next, a.currentStageId, null);
  await tx
    .update(applications)
    .set({ offerStatus: input.status, offeredCtc: input.offeredCtc, joiningDate: input.joiningDate })
    .where(eq(applications.id, a.id));
  await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: a.id, stageId: a.currentStageId, event: "completed", actorUserId: staff.id, note: `Offer ${input.status}` });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "application.offer", entityType: "application", entityId: a.id, meta: { status: input.status, outcome: next } });
}

export async function markJoined(tx: Tx, staff: Staff, applicationId: string, joinedOn: string) {
  const a = await lockApplication(tx, staff, applicationId);
  if (!canMarkJoined(a.outcome as Outcome, a.offerStatus)) throw new FlowError("Only a selected candidate whose offer was not declined can be marked joined.");
  await setOutcome(tx, staff, a, "joined", a.currentStageId, null); // decided now; joined is never purged
  await tx.update(applications).set({ joinedOn, offerStatus: a.offerStatus ?? "accepted" }).where(eq(applications.id, a.id));
  await tx.insert(queueEvents).values({ tenantId: staff.tenantId, applicationId: a.id, stageId: a.currentStageId, event: "completed", actorUserId: staff.id, note: "Joined" });
  await audit(tx, { tenantId: staff.tenantId, actorUserId: staff.id, action: "application.joined", entityType: "application", entityId: a.id });
}
