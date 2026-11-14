// Automatic deletion (retention) and "erase now". Decisions come only from src/lib/retention.ts.
// Database rows go in one transaction per candidate; files on disk are removed after it commits.
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { applications, candidateFiles, candidates, consents, queueEvents, scorecards, tenants } from "@/db/schema";
import { config, inOfficeHours } from "@/lib/config";
import type { Outcome } from "@/lib/flow";
import { SETTINGS } from "@/lib/rediscovery/settings";
import { candidateErasable, photoErasable } from "@/lib/retention";
import { audit } from "@/lib/staff";
import { storage } from "@/lib/storage";
import { log } from "@/lib/log";

const toDate = (v: string | Date | null) => (v === null ? null : new Date(v));

type VisitRow = {
  tenant_id: string;
  candidate_id: string;
  app_id: string;
  outcome: Outcome;
  purge_after: string | Date | null;
  photo_purge_after: string | Date | null;
  talent_pool: boolean;
  pool_until: string | Date | null; // end of the talent-pool keep period (Phase 3.6)
};

export type PurgePlan = { tenantId: string; photos: { fileId: string; key: string }[]; candidates: string[] };

/** What the job would delete at `now` (dry run). Optionally one tenant only. */
export async function planPurge(now: Date, tenantId?: string): Promise<PurgePlan[]> {
  const at = now.toISOString();
  // talent pool keep period per tenant (Settings → Rediscovery), default from settings.ts until saved
  const keepMonths = sql`coalesce((select (s.value #>> '{}')::int from tenant_settings s where s.tenant_id = c.tenant_id and s.key = 'talent_pool_keep_months'),
                                   ${SETTINGS.talent_pool_keep_months.default})`;
  const rows = await db.execute<VisitRow>(sql`
    with pool as (
      select c.id as candidate_id, c.tenant_id,
             coalesce(lk.talent_pool and lk.withdrawn_at is null, false) as talent_pool,
             greatest((select max(v.token_date) from applications v where v.candidate_id = c.id)::timestamp at time zone 'Asia/Kolkata', lk.accepted_at)
               + make_interval(months => ${keepMonths}) as pool_until
      from candidates c
      left join lateral (select k.talent_pool, k.withdrawn_at, k.accepted_at from consents k where k.candidate_id = c.id order by k.accepted_at desc limit 1) lk on true
      where true ${tenantId ? sql`and c.tenant_id = ${tenantId}` : sql``}
    )
    select a.tenant_id, a.candidate_id, a.id as app_id, a.outcome, a.purge_after, a.photo_purge_after, p.talent_pool, p.pool_until
    from applications a join pool p on p.candidate_id = a.candidate_id
    where a.candidate_id in (
      select candidate_id from applications
      where (purge_after <= ${at}::timestamptz or photo_purge_after <= ${at}::timestamptz)
        ${tenantId ? sql`and tenant_id = ${tenantId}` : sql``}
      union
      select candidate_id from pool where talent_pool and pool_until <= ${at}::timestamptz)`);
  const byCandidate = new Map<string, VisitRow[]>();
  for (const r of rows) byCandidate.set(r.candidate_id, [...(byCandidate.get(r.candidate_id) ?? []), r]);

  const plans = new Map<string, PurgePlan>();
  const plan = (t: string) => plans.get(t) ?? plans.set(t, { tenantId: t, photos: [], candidates: [] }).get(t)!;
  const photoApps: { tenantId: string; appId: string }[] = [];
  for (const [candidateId, visits] of byCandidate) {
    const pool = visits[0].talent_pool;
    const until = toDate(visits[0].pool_until);
    const poolExpired = pool && until !== null && until.getTime() <= now.getTime();
    const asVisits = visits.map((v) => ({ outcome: v.outcome, purgeAfter: toDate(v.purge_after), photoPurgeAfter: toDate(v.photo_purge_after) }));
    if (candidateErasable(asVisits, pool, now, poolExpired)) {
      plan(visits[0].tenant_id).candidates.push(candidateId);
      continue;
    }
    visits.forEach((v, i) => {
      if (photoErasable(asVisits[i], pool, now)) photoApps.push({ tenantId: v.tenant_id, appId: v.app_id });
    });
  }
  if (photoApps.length) {
    const files = await db
      .select({ id: candidateFiles.id, key: candidateFiles.storageKey, tenantId: candidateFiles.tenantId })
      .from(candidateFiles)
      .where(and(inArray(candidateFiles.applicationId, photoApps.map((p) => p.appId)), eq(candidateFiles.kind, "photo"), isNull(candidateFiles.deletedAt)));
    for (const f of files) plan(f.tenantId).photos.push({ fileId: f.id, key: f.key });
  }
  return [...plans.values()];
}

/** Deletes a candidate's rows (all visits, files, consents, scorecards, queue events). Returns file keys to unlink. */
export async function eraseCandidateRows(tx: Tx, tenantId: string, candidateId: string): Promise<string[]> {
  const files = await tx
    .select({ key: candidateFiles.storageKey })
    .from(candidateFiles)
    .where(and(eq(candidateFiles.tenantId, tenantId), eq(candidateFiles.candidateId, candidateId)));
  const appIds = (await tx.select({ id: applications.id }).from(applications).where(and(eq(applications.tenantId, tenantId), eq(applications.candidateId, candidateId)))).map((a) => a.id);
  if (appIds.length) {
    await tx.delete(scorecards).where(inArray(scorecards.applicationId, appIds));
    await tx.delete(queueEvents).where(inArray(queueEvents.applicationId, appIds));
  }
  await tx.delete(candidateFiles).where(and(eq(candidateFiles.tenantId, tenantId), eq(candidateFiles.candidateId, candidateId)));
  await tx.delete(consents).where(and(eq(consents.tenantId, tenantId), eq(consents.candidateId, candidateId)));
  await tx.delete(applications).where(and(eq(applications.tenantId, tenantId), eq(applications.candidateId, candidateId)));
  await tx.delete(candidates).where(and(eq(candidates.tenantId, tenantId), eq(candidates.id, candidateId))); // dsr_requests keep the log (candidate set null)
  return files.map((f) => f.key);
}

/** Removes these files from storage (local folder or S3) after the database rows are gone. Returns how many. */
export async function unlinkAll(keys: string[]) {
  if (!keys.length) return 0;
  try {
    return await storage().delete(keys);
  } catch (e) {
    // no names or keys with personal data in the log; the next run cannot find these rows again, so say so loudly
    log.error("purge.files_not_removed", { count: keys.length, reason: (e as Error).message });
    return 0;
  }
}

export type PurgeCounts = { tenantId: string; photos: number; candidates: number; files: number };

/**
 * The deletion job. Dry run returns counts only. A real run re-checks each candidate inside its own
 * transaction (nothing deleted on stale data) and writes one audit row per tenant with counts only.
 */
export async function runPurge(opts: { now?: Date; dryRun: boolean; tenantId?: string }): Promise<PurgeCounts[]> {
  const now = opts.now ?? new Date();
  const plans = await planPurge(now, opts.tenantId);
  if (opts.dryRun) return plans.map((p) => ({ tenantId: p.tenantId, photos: p.photos.length, candidates: p.candidates.length, files: 0 }));

  const tenantIds = opts.tenantId ? [opts.tenantId] : (await db.select({ id: tenants.id }).from(tenants)).map((t) => t.id);
  const out: PurgeCounts[] = [];
  for (const tenantId of tenantIds) {
    const p = plans.find((x) => x.tenantId === tenantId) ?? { tenantId, photos: [], candidates: [] };
    let candidatesDone = 0;
    let files = 0;
    for (const candidateId of p.candidates) {
      const recheck = (await planPurge(now, tenantId)).find((x) => x.tenantId === tenantId);
      if (!recheck?.candidates.includes(candidateId)) continue;
      const keys = await db.transaction((tx) => eraseCandidateRows(tx, tenantId, candidateId));
      files += await unlinkAll(keys);
      candidatesDone++;
    }
    const photoIds = p.photos.map((f) => f.fileId);
    if (photoIds.length) {
      const marked = await db
        .update(candidateFiles)
        .set({ deletedAt: now })
        .where(and(inArray(candidateFiles.id, photoIds), isNull(candidateFiles.deletedAt)))
        .returning({ key: candidateFiles.storageKey });
      files += await unlinkAll(marked.map((m) => m.key));
    }
    await audit(db, {
      tenantId,
      actorUserId: null,
      action: "retention.purge",
      entityType: "tenant",
      entityId: tenantId,
      meta: { photos: photoIds.length, candidates: candidatesDone, files },
    });
    out.push({ tenantId, photos: photoIds.length, candidates: candidatesDone, files });
  }
  return out;
}

// ---------- scheduler (started from src/instrumentation.ts) ----------

const g = globalThis as unknown as { purgeTimer?: ReturnType<typeof setInterval>; purgeRunning?: boolean };

async function tick() {
  if (g.purgeRunning) return; // never two runs at once
  if (inOfficeHours(new Date(), config().OFFICE_HOURS)) return; // waits until the office is closed (OFFICE_HOURS)
  g.purgeRunning = true;
  try {
    const counts = await runPurge({ dryRun: false });
    const total = counts.reduce((n, c) => n + c.photos + c.candidates, 0);
    if (total) log.info("retention.deleted", { candidates: counts.reduce((n, c) => n + c.candidates, 0), photos: counts.reduce((n, c) => n + c.photos, 0) });
  } catch (e) {
    log.error("retention.failed", { reason: (e as Error).message });
  } finally {
    g.purgeRunning = false;
  }
}

export function startPurgeScheduler() {
  if (g.purgeTimer) return;
  const { PURGE_INTERVAL_MINUTES: every, OFFICE_HOURS: hours } = config();
  log.info("retention.scheduled", { everyMinutes: every, officeHours: hours ?? null });
  g.purgeTimer = setInterval(tick, every * 60 * 1000);
  setTimeout(tick, 15_000); // shortly after start-up
}
