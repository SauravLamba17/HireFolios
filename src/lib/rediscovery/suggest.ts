// Suggestion rules (pure, unit-tested): which tag to suggest for a past candidate, and why. A suggestion is never a
// tag until a person accepts it. docs/REDISCOVERY.md section B.
import { CAT, costText, TAG } from "@/lib/rediscovery/categories";
import { fmtScore, type CandidateSummary, type VisitSummary } from "@/lib/rediscovery/summary";

export type SuggestTag = typeof TAG.highCost | typeof TAG.nearMiss;
export type Suggestion = { tag: SuggestTag; reason: string; applicationId: string; decidedAt: Date };
export type Dismissal = { tag: string; applicationId: string; decidedAt: Date };

export type SuggestInput = {
  summary: Pick<CandidateSummary, "lastDecided" | "everJoined">;
  activeTags: string[];
  dismissals: Dismissal[];
  threshold: number;
  lastRoundStageId: string | null; // last active interview round of the tenant
};

const sameDecision = (d: Dismissal, v: VisitSummary, tag: string) => d.tag === tag && d.applicationId === v.id && d.decidedAt.getTime() === v.decidedAt!.getTime();

export function suggest(input: SuggestInput): { suggestions: Suggestion[]; note: string | null } {
  const { summary, activeTags, dismissals, threshold, lastRoundStageId } = input;
  const none = (note: string | null) => ({ suggestions: [], note });
  if (summary.everJoined) return none(null); // employees are not rediscovered
  if (activeTags.includes(TAG.doNotRehire)) return none(null);
  const v = summary.lastDecided;
  if (!v || !v.decidedAt || (v.outcome !== "rejected" && v.outcome !== "offer_declined")) return none(null);
  if (v.avg === null) return none("No interview scores, so no suggestion.");

  const strong = v.avg >= threshold; // inclusive: 3.5 ≥ 3.5
  const avgText = `avg ${fmtScore(v.avg)} ${strong ? "≥" : "<"} ${fmtScore(threshold)}`;
  const reachedLast = lastRoundStageId !== null && v.rounds.some((r) => r.stageId === lastRoundStageId);
  const lastName = v.rounds.find((r) => r.stageId === lastRoundStageId)?.name;
  const c = v.category;
  const out: Suggestion[] = [];
  const add = (tag: SuggestTag, reason: string) => {
    if (activeTags.includes(tag)) return;
    if (dismissals.some((d) => sameDecision(d, v, tag))) return;
    out.push({ tag, reason, applicationId: v.id, decidedAt: v.decidedAt! });
  };

  if (c?.code === CAT.cost && strong) {
    const what = v.outcome === "rejected" ? "Rejected for Cost" : "Declined our offer over Cost";
    add(TAG.highCost, `${what}: ${costText(v.cost, v.outcome === "rejected" ? "budget" : "offered").replace(/ vs (budget|offered) /, " vs ")} · ${avgText}`);
  }
  if (v.outcome === "offer_declined") {
    add(TAG.nearMiss, `Declined our offer${c ? ` (${c.label})` : ""} · ${avgText}`);
  } else if (c?.kind === "non_skill" && (reachedLast || strong)) {
    const why = [reachedLast ? `reached the last round (${lastName})` : null, strong ? avgText : null].filter(Boolean).join(" · ");
    add(TAG.nearMiss, `Rejected for ${c.label} (not a skill reason) · ${why}`);
  }
  return { suggestions: out, note: null };
}
