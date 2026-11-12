// Reject categories, rediscovery tags and cost figures (pure, browser-safe). docs/REDISCOVERY.md section A / B.
// The lists themselves live per tenant in option_items (Settings → Lists); these are the seed source and the codes
// the rules use. Rules never look at labels, so HR may rename freely.
import { rupeesToLpa } from "@/lib/money";

export type CategoryKind = "skill" | "non_skill" | "neutral";
export const CATEGORY_KINDS: Record<CategoryKind, string> = { skill: "Skill", non_skill: "Not a skill reason", neutral: "Neutral" };
export const isCategoryKind = (v: unknown): v is CategoryKind => typeof v === "string" && v in CATEGORY_KINDS;

/** Codes the rules depend on. */
export const CAT = { cost: "cost", shiftLocation: "shift_location", noticeTiming: "notice_timing", seatFilled: "seat_filled", noShow: "no_show", other: "other" } as const;
export const TAG = { highCost: "high_cost", nearMiss: "near_miss", reconsider: "reconsider", doNotRehire: "do_not_rehire" } as const;
/** Tags the rules use: can be renamed, never retired. */
export const SYSTEM_TAGS: readonly string[] = Object.values(TAG);

export const DEFAULT_CATEGORIES: { code: string; label: string; kind: CategoryKind }[] = [
  { code: "cost", label: "Cost / salary expectation", kind: "non_skill" },
  { code: "knowledge", label: "Knowledge / skills", kind: "skill" },
  { code: "communication", label: "Communication / English", kind: "skill" },
  { code: "typing_voice", label: "Typing / voice test", kind: "skill" },
  { code: "attitude", label: "Attitude / stability", kind: "skill" },
  { code: "shift_location", label: "Shift / location / availability", kind: "non_skill" },
  { code: "notice_timing", label: "Notice period / timing", kind: "non_skill" },
  { code: "seat_filled", label: "Seat filled / better candidate chosen", kind: "non_skill" },
  { code: "documents", label: "Documents / background", kind: "neutral" },
  { code: "no_show", label: "No-show / walked away", kind: "neutral" },
  { code: "other", label: "Other", kind: "neutral" },
];

export const DEFAULT_TAGS: { code: string; label: string }[] = [
  { code: TAG.highCost, label: "Good but high cost" },
  { code: TAG.nearMiss, label: "Near-miss (silver medal)" },
  { code: TAG.reconsider, label: "Good — reconsider later" },
  { code: TAG.doNotRehire, label: "Do not rehire" },
];

/** Category of each sample reject reason (src/lib/options.ts REJECT_REASONS); the migration backfills the same. */
export const SAMPLE_REASON_CATEGORY: Record<string, string> = {
  "Spoken English / communication": "communication",
  "Typing speed below requirement": "typing_voice",
  "No relevant RCM experience": "knowledge",
  "Required certification missing": "knowledge",
  "Failed assessment / test": "knowledge",
  "Salary expectation above budget": "cost",
  "Notice period too long": "notice_timing",
  "Not willing to work US / night shift": "shift_location",
  "Did not attend the round": "no_show",
  Other: "other",
};
export const categoryForSampleReason = (label: string) => SAMPLE_REASON_CATEGORY[label] ?? CAT.other;

/** A category as the rules see it. */
export type Category = { code: string; label: string; kind: CategoryKind };

/** A reject reason as the reject forms show it: its category next to it; cost reasons ask for the figures. */
export type ReasonOption = { label: string; category: string; isCost: boolean };
/** A category HR can pick for a declined offer. */
export type CategoryOption = { code: string; label: string };

/** Code for an item HR adds in Settings → Lists (stable, never shown). */
export const newItemCode = () => `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

export type CostGap = { expected: number | null; budget: number | null; gapRupees: number | null; gapPercent: number | null };

/** Gap between what the candidate asked and our budget / offer (whole rupees per year). */
export function costGap(expected: number | null, budget: number | null): CostGap {
  if (expected === null || budget === null) return { expected, budget, gapRupees: null, gapPercent: null };
  const gapRupees = expected - budget;
  return { expected, budget, gapRupees, gapPercent: budget > 0 ? Math.round((gapRupees / budget) * 100) : null };
}

const lpa = (r: number) => {
  const v = rupeesToLpa(r);
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
};
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * "asked 4.2 vs budget 3.0 LPA (+40%)"; `against` names the other figure ("budget" or "offered").
 * Missing figures are said, never guessed.
 */
export function costText(g: Pick<CostGap, "expected" | "budget">, against: "budget" | "offered" = "budget") {
  const { expected, budget } = g;
  if (expected === null && budget === null) return "no figures recorded";
  if (expected === null) return `${against} ${lpa(budget!)} LPA, ask not recorded`;
  if (budget === null) return `asked ${lpa(expected)} LPA, ${against} not recorded`;
  const pct = costGap(expected, budget).gapPercent;
  return `asked ${lpa(expected)} vs ${against} ${lpa(budget)} LPA${pct === null ? "" : ` (${signed(pct)}%)`}`;
}
