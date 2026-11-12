// Bulk hiring ranking (pure, unit-tested, transparent): every part is 0–1, the score is the weighted mean × 100, and
// every row says why in words. docs/REDISCOVERY.md section E.
import { rupeesToLpa } from "@/lib/money";
import { fmtScore } from "@/lib/rediscovery/summary";

/** Per-person status on a hiring push. */
export const PUSH_STATUSES = {
  to_call: "To call",
  no_answer: "Called — no answer",
  interested: "Interested",
  not_interested: "Not interested",
  booked: "Booked for interview",
  hired: "Hired",
} as const;
export type PushStatus = keyof typeof PUSH_STATUSES;

export type Weights = { budget: number; score: number; skills: number; shift: number; improvement: number; recency: number };
export const WEIGHT_LABELS: Record<keyof Weights, string> = {
  budget: "Budget fit",
  score: "Interview score",
  skills: "Skills match",
  shift: "Shift fit",
  improvement: "Score improvement",
  recency: "Recent visit",
};

export type BulkCriteria = {
  budget: number | null; // rupees per year
  certifications: string[];
  software: string[];
  minExperienceMonths: number | null;
  night: boolean;
  voice: boolean;
};

export type RankInput = {
  expectedCtc: number | null;
  avg: number | null;
  delta: number | null; // score change between visits
  certifications: string[];
  software: string[];
  experienceMonths: number | null;
  nightShiftOk: boolean | null;
  voiceProcess: boolean | null;
  lastVisitDay: string;
  source: string; // why they are on the list, e.g. "Cost reject" (from the caller)
};

export type Ranked = { score: number; parts: Record<keyof Weights, number>; why: string; overBudgetPercent: number | null };

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const lpa = (r: number) => {
  const v = rupeesToLpa(r);
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
};
const monthsBetween = (fromDay: string, toDay: string) =>
  (Number(toDay.slice(0, 4)) - Number(fromDay.slice(0, 4))) * 12 + (Number(toDay.slice(5, 7)) - Number(fromDay.slice(5, 7)));

/** Percent the ask is over the budget (≤ 0: within), or null when either is unknown. */
export const overBudget = (expected: number | null, budget: number | null) =>
  expected === null || budget === null || budget <= 0 ? null : Math.round(((expected - budget) / budget) * 100);

export function rank(c: RankInput, k: BulkCriteria, w: Weights, opts: { today: string; recencyMonths: number; overBudgetLimit: number }): Ranked {
  const why: string[] = [c.source];
  // budget: within = 1; slightly over falls from 1 to 0.5 at the allowed limit (more is left out); unknown = 0.5
  const over = overBudget(c.expectedCtc, k.budget);
  let budget = 0.5;
  if (k.budget === null) budget = 1;
  else if (c.expectedCtc === null) why.push("expected CTC not recorded");
  else if (over! <= 0) {
    budget = 1;
    why.push(`asked ${lpa(c.expectedCtc)} ≤ budget ${lpa(k.budget)}`);
  } else {
    budget = opts.overBudgetLimit > 0 ? 1 - 0.5 * clamp(over! / opts.overBudgetLimit) : 0.5;
    why.push(`+${over}% over budget (asked ${lpa(c.expectedCtc)})`);
  }
  const score = c.avg === null ? 0 : clamp((c.avg - 1) / 4);
  why.push(c.avg === null ? "no scores" : `avg ${fmtScore(c.avg)}`);

  const checks: boolean[] = [];
  for (const cert of k.certifications) {
    const has = c.certifications.includes(cert);
    checks.push(has);
    why.push(has ? cert : `no ${cert}`);
  }
  for (const sw of k.software) {
    const has = c.software.includes(sw);
    checks.push(has);
    why.push(has ? sw : `no ${sw}`);
  }
  if (k.minExperienceMonths !== null) {
    const ok = (c.experienceMonths ?? 0) >= k.minExperienceMonths;
    checks.push(ok);
    if (!ok) why.push("less experience than asked");
  }
  const skills = checks.length ? checks.filter(Boolean).length / checks.length : 1;

  const shiftParts: number[] = [];
  if (k.night) {
    shiftParts.push(c.nightShiftOk === null ? 0.5 : c.nightShiftOk ? 1 : 0);
    why.push(c.nightShiftOk === null ? "night shift not asked" : c.nightShiftOk ? "night OK" : "no night shift");
  }
  if (k.voice) {
    shiftParts.push(c.voiceProcess === null ? 0.5 : c.voiceProcess ? 1 : 0);
    why.push(c.voiceProcess === null ? "voice not asked" : c.voiceProcess ? "voice OK" : "no voice process");
  }
  const shift = shiftParts.length ? shiftParts.reduce((a, b) => a + b, 0) / shiftParts.length : 1;

  const improvement = c.delta === null ? 0.5 : clamp(0.5 + c.delta / 2);
  if (c.delta !== null && Math.abs(c.delta) >= 0.1) why.push(`score ${c.delta > 0 ? "↑ +" : "↓ "}${c.delta.toFixed(1)}`);
  const months = Math.max(0, monthsBetween(c.lastVisitDay, opts.today));
  const recency = clamp(1 - months / Math.max(1, opts.recencyMonths));

  const parts = { budget, score, skills, shift, improvement, recency };
  const total = (Object.keys(parts) as (keyof Weights)[]).reduce((a, key) => a + w[key], 0);
  const value = total > 0 ? (Object.keys(parts) as (keyof Weights)[]).reduce((a, key) => a + w[key] * parts[key], 0) / total : 0;
  return { score: Math.round(value * 100), parts, why: why.join(" · "), overBudgetPercent: over };
}

/** Best first; ties: higher interview score, then the more recent visit. */
export const byRank = <T extends { ranked: Ranked; avg: number | null; lastVisitDay: string }>(a: T, b: T) =>
  b.ranked.score - a.ranked.score || (b.avg ?? 0) - (a.avg ?? 0) || b.lastVisitDay.localeCompare(a.lastVisitDay);
