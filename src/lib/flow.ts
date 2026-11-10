// Stage / outcome rules for a candidate's visit. Pure functions: the drive and interview APIs load the
// rows, call these, and write the result (plus queue_events and audit_log) in one transaction.

export type StageInfo = { id: string; position: number; active: boolean; isInterview: boolean };
export type Decision = "pass" | "hold" | "reject";
export type Outcome = "in_progress" | "selected" | "rejected" | "on_hold" | "withdrawn" | "no_show";

export class FlowError extends Error {}
/** A row that does not exist for this tenant (another tenant's id looks the same): answered with 404. */
export class NotFoundError extends FlowError {}

const byPosition = (stages: StageInfo[]) => [...stages].sort((a, b) => a.position - b.position);

function positionOf(stages: StageInfo[], stageId: string) {
  const s = stages.find((x) => x.id === stageId);
  if (!s) throw new FlowError("Unknown stage");
  return s.position;
}

/** First active interview round after the given stage, or null. */
export function nextInterviewStage(stages: StageInfo[], afterStageId: string): StageInfo | null {
  const pos = positionOf(stages, afterStageId);
  return byPosition(stages).find((s) => s.active && s.isInterview && s.position > pos) ?? null;
}

/**
 * The interview round a waiting candidate is queued for: their current stage if it is an active
 * interview round, otherwise the next one (new walk-ins sit at "Registered" and wait for the first round).
 */
export function queueStage(stages: StageInfo[], currentStageId: string): StageInfo | null {
  const cur = stages.find((s) => s.id === currentStageId);
  if (cur?.active && cur.isInterview) return cur;
  return nextInterviewStage(stages, currentStageId);
}

export type Move = { outcome: Outcome; stageId: string; rejectReason: string | null };

/**
 * A panel's decision at the candidate's current interview stage:
 * - pass → next active interview round, back to waiting; pass at the last round → Selected
 *   (and moved to the next active stage after it, e.g. "Offer", if there is one)
 * - hold → On hold at the same stage (HR can resume later)
 * - reject → Rejected, a reason is required
 */
export function applyDecision(stages: StageInfo[], currentStageId: string, decision: Decision, rejectReason?: string | null): Move {
  const pos = positionOf(stages, currentStageId);
  if (decision === "hold") return { outcome: "on_hold", stageId: currentStageId, rejectReason: null };
  if (decision === "reject") {
    const reason = rejectReason?.trim();
    if (!reason) throw new FlowError("Choose a reject reason");
    return { outcome: "rejected", stageId: currentStageId, rejectReason: reason };
  }
  const next = nextInterviewStage(stages, currentStageId);
  if (next) return { outcome: "in_progress", stageId: next.id, rejectReason: null };
  const after = byPosition(stages).find((s) => s.active && s.position > pos);
  return { outcome: "selected", stageId: after?.id ?? currentStageId, rejectReason: null };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_HIRED: Outcome[] = ["rejected", "no_show", "withdrawn"];
const FINAL: Outcome[] = ["selected", ...NOT_HIRED];

/**
 * Columns to write whenever an outcome is set. Final outcomes get decided_at; candidates who were not hired
 * also get purge dates (data and photo retention), unless they opted into the talent pool. Moving back to
 * in progress / on hold clears all three.
 */
export function outcomeDates(
  outcome: Outcome,
  now: Date,
  tenant: { dataRetentionDays: number; photoRetentionDays: number },
  talentPool: boolean,
): { decidedAt: Date | null; purgeAfter: Date | null; photoPurgeAfter: Date | null } {
  if (!FINAL.includes(outcome)) return { decidedAt: null, purgeAfter: null, photoPurgeAfter: null };
  if (!NOT_HIRED.includes(outcome) || talentPool) return { decidedAt: now, purgeAfter: null, photoPurgeAfter: null };
  return {
    decidedAt: now,
    purgeAfter: new Date(now.getTime() + tenant.dataRetentionDays * DAY_MS),
    photoPurgeAfter: new Date(now.getTime() + tenant.photoRetentionDays * DAY_MS),
  };
}

export type WaitingCard = { applicationId: string; queuedAt: Date; token: string };

/** Oldest in the queue first (time they started waiting for this round), then token as a tie-break. */
export const queueOrder = (a: WaitingCard, b: WaitingCard) =>
  a.queuedAt.getTime() - b.queuedAt.getTime() || a.token.localeCompare(b.token);

/** "Assign next": the candidate who has waited longest for this round, or null if nobody is waiting. */
export function pickNext(waiting: WaitingCard[]): WaitingCard | null {
  return [...waiting].sort(queueOrder)[0] ?? null;
}

export const MIN_FINISHED_FOR_LIVE_AVERAGE = 3;

/**
 * Wait estimate for the n-th person (1-based) in a round's queue:
 * position × average interview minutes ÷ panels working on that round.
 * Uses today's real average once at least 3 interviews have finished; before that, HR's default from
 * Settings if set (labelled an estimate); otherwise no number at all.
 */
export function waitEstimate(input: {
  position: number;
  panels: number;
  finishedToday: number;
  averageToday: number | null;
  defaultMinutes: number | null;
}): { minutes: number; kind: "today" | "estimate" } | null {
  const { position, panels, finishedToday, averageToday, defaultMinutes } = input;
  if (panels <= 0 || position <= 0) return null;
  const calc = (avg: number) => Math.max(1, Math.ceil((position * avg) / panels));
  if (finishedToday >= MIN_FINISHED_FOR_LIVE_AVERAGE && averageToday !== null) return { minutes: calc(averageToday), kind: "today" };
  if (defaultMinutes && defaultMinutes > 0) return { minutes: calc(defaultMinutes), kind: "estimate" };
  return null;
}

/** Interviewers only see candidates they interview(ed); roles with the candidates permission see all. */
export const mayViewCandidate = (canSeeAll: boolean, everAssignedToMe: boolean) => canSeeAll || everAssignedToMe;
