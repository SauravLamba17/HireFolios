// Score change between a candidate's last two scored visits (pure, unit-tested). docs/REDISCOVERY.md section B.
import { fmtScore, type VisitSummary } from "@/lib/rediscovery/summary";

export type ScoreChange = { from: number; to: number; delta: number; dir: "up" | "down" | "flat"; basis: "same rounds" | "different rounds"; text: string };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** `visits` latest first (as summarize() returns them). Null when fewer than two visits have scores. */
export function scoreChange(visits: Pick<VisitSummary, "avg" | "rounds">[]): ScoreChange | null {
  const scored = visits.filter((v) => v.avg !== null);
  if (scored.length < 2) return null;
  const [now, before] = scored; // latest, the one before
  const scoredRounds = (v: Pick<VisitSummary, "rounds">) => new Map(v.rounds.filter((r) => r.avg !== null).map((r) => [r.name, r.avg!]));
  const a = scoredRounds(before), b = scoredRounds(now);
  const shared = [...a.keys()].filter((k) => b.has(k));
  const same = shared.length > 0;
  const from = same ? mean(shared.map((k) => a.get(k)!)) : before.avg!;
  const to = same ? mean(shared.map((k) => b.get(k)!)) : now.avg!;
  const delta = Math.round((to - from) * 10) / 10 || 0; // no -0
  const dir = delta >= 0.1 ? "up" : delta <= -0.1 ? "down" : "flat";
  const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
  const signed = delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  return { from, to, delta, dir, basis: same ? "same rounds" : "different rounds", text: `${arrow} ${fmtScore(from)} → ${fmtScore(to)}, ${signed}${same ? "" : " (different rounds)"}` };
}
