// Hiring summary (pure, unit-tested): a candidate's whole story from their visits and scorecards.
// docs/REDISCOVERY.md section A. Works on whatever rows remain (retention may have removed some).
import type { OfferStatus, Outcome } from "@/lib/flow";
import { formatDayIST } from "@/lib/ist";
import { formatLpa } from "@/lib/money";
import { CAT, costText, type Category } from "@/lib/rediscovery/categories";

export type VisitInput = {
  id: string;
  day: string; // IST token day
  createdAt: Date;
  job: string;
  outcome: Outcome;
  stage: string; // current stage name
  rejectReason: string | null;
  category: Category | null;
  costExpected: number | null;
  costBudget: number | null;
  decidedAt: Date | null;
  offerStatus: OfferStatus | null;
  offeredCtc: number | null;
  joiningDate: string | null;
  joinedOn: string | null;
  /** Cost figures withheld from this viewer (no rediscovery permission): the reason is named without them. */
  costHidden?: boolean;
};

export type CardInput = {
  applicationId: string;
  stageId: string;
  stageName: string;
  stagePosition: number;
  interviewer: string | null;
  scores: Record<string, number>;
  overall: number | null;
  comments: string | null;
  at: Date;
};

export type Status = "hired" | "selected" | "not_hired" | "didnt_finish" | "in_progress" | "on_hold";
export const STATUS_LABELS: Record<Status, string> = {
  hired: "Hired",
  selected: "Selected",
  not_hired: "Not hired",
  didnt_finish: "Didn't finish",
  in_progress: "In progress",
  on_hold: "On hold",
};

export type RoundSummary = { stageId: string; name: string; position: number; avg: number | null };
export type VisitSummary = {
  id: string;
  day: string;
  job: string;
  outcome: Outcome;
  status: Status;
  statusLabel: string;
  rounds: RoundSummary[];
  avg: number | null; // unrounded; show with fmtScore
  strongest: { label: string; avg: number } | null;
  weakest: { label: string; avg: number } | null;
  notes: { at: Date; interviewer: string | null; stage: string; text: string }[];
  decidedAt: Date | null;
  category: Category | null;
  reason: string | null; // "Cost: asked 4.2 vs budget 3.0 LPA (+40%)"
  cost: { expected: number | null; budget: number | null }; // figures of a cost decision (rupees per year)
  line: string;
};
export type CandidateSummary = {
  visits: VisitSummary[]; // latest first
  latest: VisitSummary | null;
  lastDecided: VisitSummary | null; // latest visit with a final decision
  overallAvg: number | null;
  everJoined: boolean;
  line: string;
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** 1 decimal for display: 4.0, 3.5. */
export const fmtScore = (v: number | null) => (v === null ? "—" : (Math.round(v * 10) / 10).toFixed(1));

/** A scorecard's average: its criterion scores, or its overall when it has none. */
export function cardAverage(c: Pick<CardInput, "scores" | "overall">) {
  const vals = Object.values(c.scores ?? {}).filter((n) => typeof n === "number");
  return mean(vals) ?? c.overall ?? null;
}

export function statusOf(v: Pick<VisitInput, "outcome" | "offerStatus">): { status: Status; label: string } {
  switch (v.outcome) {
    case "joined":
      return { status: "hired", label: "Hired" };
    case "selected":
      return { status: "selected", label: v.offerStatus ? "Offered" : "Selected" };
    case "rejected":
      return { status: "not_hired", label: "Not hired" };
    case "no_show":
    case "withdrawn":
    case "offer_declined":
      return { status: "didnt_finish", label: "Didn't finish" };
    case "on_hold":
      return { status: "on_hold", label: "On hold" };
    default:
      return { status: "in_progress", label: "In progress" };
  }
}

/** Why the visit ended the way it did, in words (null when it is still open or ended well). */
export function reasonText(v: VisitInput): string | null {
  const c = v.category;
  if (v.outcome === "rejected") {
    if (!c) return v.rejectReason;
    if (c.code === CAT.cost && !v.costHidden) return `${c.label}: ${costText({ expected: v.costExpected, budget: v.costBudget })}`;
    return v.rejectReason && v.rejectReason !== c.label ? `${c.label}: ${v.rejectReason}` : c.label;
  }
  if (v.outcome === "no_show") return "No show";
  if (v.outcome === "withdrawn") return "Walked away";
  if (v.outcome === "offer_declined") {
    if (!c) return "Offer declined";
    if (c.code === CAT.cost && !v.costHidden) return `Offer declined (${c.label}: ${costText({ expected: v.costExpected, budget: v.costBudget }, "offered")})`;
    return `Offer declined (${c.label})`;
  }
  return null;
}

export function summarizeVisit(v: VisitInput, cards: CardInput[]): VisitSummary {
  const mine = cards.filter((c) => c.applicationId === v.id).sort((a, b) => a.stagePosition - b.stagePosition || a.at.getTime() - b.at.getTime());
  const byStage = new Map<string, CardInput[]>();
  for (const c of mine) byStage.set(c.stageId, [...(byStage.get(c.stageId) ?? []), c]);
  const rounds: RoundSummary[] = [...byStage.values()].map((cs) => ({
    stageId: cs[0].stageId,
    name: cs[0].stageName,
    position: cs[0].stagePosition,
    avg: mean(cs.map(cardAverage).filter((n): n is number => n !== null)),
  }));
  const avg = mean(rounds.map((r) => r.avg).filter((n): n is number => n !== null));

  const per = new Map<string, number[]>(); // insertion order = stage order, then criterion order
  for (const c of mine) for (const [k, n] of Object.entries(c.scores ?? {})) per.set(k, [...(per.get(k) ?? []), n]);
  const crit = [...per.entries()].map(([label, xs]) => ({ label, avg: mean(xs)! }));
  let strongest = null, weakest = null;
  if (crit.length >= 2) {
    strongest = crit.reduce((a, b) => (b.avg > a.avg ? b : a));
    weakest = crit.reduce((a, b) => (b.avg < a.avg ? b : a));
    if (strongest.avg === weakest.avg) strongest = weakest = null; // all equal: nothing stands out
  }
  const notes = mine
    .filter((c) => c.comments?.trim())
    .map((c) => ({ at: c.at, interviewer: c.interviewer, stage: c.stageName, text: c.comments!.trim() }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const { status, label } = statusOf(v);
  const reason = reasonText(v);
  const reached = rounds.length ? `reached ${rounds[rounds.length - 1].name}` : "no interview scores";
  const scored = avg === null ? null : `avg ${fmtScore(avg)}/5`;
  let head: string;
  switch (status) {
    case "hired":
      head = `Hired${v.joinedOn ? ` — joined ${formatDayIST(v.joinedOn)}` : ""}`;
      break;
    case "selected": {
      const offer = v.offerStatus
        ? `offer ${v.offerStatus}${v.offeredCtc !== null ? ` at ${formatLpa(v.offeredCtc)}` : ""}${v.joiningDate ? `, joining ${formatDayIST(v.joiningDate)}` : ""}`
        : "no offer recorded yet";
      head = `${label} — ${offer}`;
      break;
    }
    case "in_progress":
      head = `In progress — ${v.stage}`;
      break;
    case "on_hold":
      head = `On hold — ${v.stage}`;
      break;
    default:
      head = `${label}${reason ? ` — ${reason}` : ""}`;
  }
  const open = status === "in_progress" || status === "on_hold"; // the head already names the stage
  const line = [head, open ? null : reached, scored].filter(Boolean).join(" · ");
  return { id: v.id, day: v.day, job: v.job, outcome: v.outcome, status, statusLabel: label, rounds, avg, strongest, weakest, notes, decidedAt: v.decidedAt, category: v.category, reason, cost: { expected: v.costExpected, budget: v.costBudget }, line };
}

const FINAL: Outcome[] = ["selected", "joined", "rejected", "no_show", "withdrawn", "offer_declined"];

export function summarize(visits: VisitInput[], cards: CardInput[]): CandidateSummary {
  const ordered = [...visits].sort((a, b) => b.day.localeCompare(a.day) || b.createdAt.getTime() - a.createdAt.getTime());
  const out = ordered.map((v) => summarizeVisit(v, cards));
  const latest = out[0] ?? null;
  const lastDecided =
    [...out]
      .filter((v) => FINAL.includes(v.outcome) && v.decidedAt)
      .sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())[0] ?? null;
  const overallAvg = mean(out.map((v) => v.avg).filter((n): n is number => n !== null));
  const line = latest ? (out.length > 1 ? `${latest.line} · ${out.length} visits` : latest.line) : "No visits";
  return { visits: out, latest, lastDecided, overallAvg, everJoined: out.some((v) => v.outcome === "joined"), line };
}
