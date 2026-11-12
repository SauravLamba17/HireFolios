// Retention and deletion rules (pure, unit-tested). The deletion job (src/lib/purge.ts) and the
// "erase now" button only ever delete what these functions allow.
import { outcomeDates, type Outcome } from "@/lib/flow";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Limits for Settings → retention. Photos never outlive the rest of the data. */
export const RETENTION_LIMITS = {
  cooldownDays: { min: 0, max: 365 },
  photoRetentionDays: { min: 30, max: 3650 },
  dataRetentionDays: { min: 30, max: 3650 },
} as const;

export type Retention = { cooldownDays: number; photoRetentionDays: number; dataRetentionDays: number };

export function retentionProblem(r: Retention): string | null {
  for (const [k, lim] of Object.entries(RETENTION_LIMITS) as [keyof Retention, { min: number; max: number }][]) {
    const v = r[k];
    if (!Number.isInteger(v) || v < lim.min || v > lim.max) return `${k} must be a whole number from ${lim.min} to ${lim.max}.`;
  }
  if (r.photoRetentionDays > r.dataRetentionDays) return "Photos can't be kept longer than the rest of the data.";
  return null;
}

export type VisitForPurge = { outcome: Outcome; purgeAfter: Date | null; photoPurgeAfter: Date | null };

/**
 * A whole candidate may be deleted only when ALL of these hold:
 * - they are not in the talent pool (latest consent),
 * - no visit ended in "joined",
 * - every visit has a purge date and it has passed (an open, on-hold, selected or newer visit has none
 *   or a later one, which keeps the candidate).
 */
export function candidateErasable(visits: VisitForPurge[], talentPool: boolean, now: Date, poolExpired = false): boolean {
  if (visits.length === 0) return false;
  if (visits.some((v) => v.outcome === "joined")) return false;
  // Talent pool (Phase 3.6): kept for the keep period after the last visit / consent renewal, then erasable unless
  // a visit is still open (in progress, on hold, selected). Tags never keep anyone.
  if (talentPool) return poolExpired && visits.every((v) => !OPEN.includes(v.outcome));
  return visits.every((v) => v.purgeAfter !== null && v.purgeAfter.getTime() <= now.getTime());
}
const OPEN: Outcome[] = ["in_progress", "on_hold", "selected"];

/** End of a talent-pool candidate's keep period: the later of their last visit day and last consent, plus the months. */
export function poolKeptUntil(lastVisitDay: string | null, lastConsentAt: Date | null, months: number): Date | null {
  const visit = lastVisitDay ? new Date(`${lastVisitDay}T00:00:00+05:30`) : null;
  const from = [visit, lastConsentAt].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0];
  if (!from) return null;
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** One visit's photo may be deleted when its photo date has passed (never for joined / talent pool). */
export function photoErasable(visit: VisitForPurge, talentPool: boolean, now: Date): boolean {
  if (talentPool || visit.outcome === "joined") return false;
  return visit.photoPurgeAfter !== null && visit.photoPurgeAfter.getTime() <= now.getTime();
}

/** Purge dates for a decided visit under (possibly new) retention days: "re-calculate existing". */
export function recalculatedDates(
  visit: { outcome: Outcome; decidedAt: Date | null },
  tenant: { dataRetentionDays: number; photoRetentionDays: number },
  talentPool: boolean,
): { purgeAfter: Date | null; photoPurgeAfter: Date | null } {
  if (!visit.decidedAt) return { purgeAfter: null, photoPurgeAfter: null };
  const { purgeAfter, photoPurgeAfter } = outcomeDates(visit.outcome, visit.decidedAt, tenant, talentPool);
  return { purgeAfter, photoPurgeAfter };
}

/** Rights requests must be answered within 90 days of receipt. */
export const DSR_DAYS = 90;
export const dsrDueAt = (receivedAt: Date) => new Date(receivedAt.getTime() + DSR_DAYS * DAY_MS);
export const dsrOverdue = (r: { dueAt: Date | null; status: string }, now: Date) =>
  r.dueAt !== null && r.dueAt.getTime() < now.getTime() && (r.status === "open" || r.status === "in_progress");

/**
 * What happens to a candidate's data, in words for HR (profile Summary card): kept as an employee, kept by
 * talent-pool consent (until its keep period ends), kept while a visit is open, or deleted on a date.
 */
export function keepText(visits: { outcome: Outcome; purgeAfter: Date | null }[], pool: { inPool: boolean; until: Date | null }, fmt: (d: Date) => string): string {
  if (visits.some((v) => v.outcome === "joined")) return "Kept (employee record)";
  if (pool.inPool) return pool.until ? `Kept (talent-pool consent until ${fmt(pool.until)})` : "Kept (talent-pool consent)";
  if (visits.length === 0) return "No visits";
  if (visits.some((v) => v.purgeAfter === null)) return "Kept while a visit is open or undecided";
  return `Data deletes on ${fmt(new Date(Math.max(...visits.map((v) => v.purgeAfter!.getTime()))))}`;
}
