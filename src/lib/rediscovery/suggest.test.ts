import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "./categories";
import { suggest, type SuggestInput } from "./suggest";
import type { RoundSummary, VisitSummary } from "./summary";
import { scoreChange } from "./trend";

const cat = (code: string) => {
  const c = DEFAULT_CATEGORIES.find((x) => x.code === code)!;
  return { code: c.code, label: c.label, kind: c.kind };
};
const LAST = "s-mgr";
const round = (name: string, avg: number | null, stageId = `s-${name}`): RoundSummary => ({ stageId, name, position: 1, avg });
const decided = new Date("2026-11-01T08:00:00Z");
const visit = (o: Partial<VisitSummary> = {}): VisitSummary => ({
  id: "app1",
  day: "2026-11-01",
  job: "AR Caller",
  outcome: "rejected",
  status: "not_hired",
  statusLabel: "Not hired",
  rounds: [round("HR screen", 4.1)],
  avg: 4.1,
  strongest: null,
  weakest: null,
  notes: [],
  decidedAt: decided,
  category: cat("cost"),
  reason: null,
  cost: { expected: 420000, budget: 300000 },
  line: "",
  ...o,
});
const input = (v: VisitSummary | null, o: Partial<SuggestInput> = {}): SuggestInput => ({
  summary: { lastDecided: v, everJoined: false },
  activeTags: [],
  dismissals: [],
  threshold: 3.5,
  lastRoundStageId: LAST,
  ...o,
});
const tags = (r: ReturnType<typeof suggest>) => r.suggestions.map((s) => s.tag).sort();

describe("suggestions", () => {
  it("cost rejection of a strong candidate: Good but high cost (+ near-miss, cost is not a skill reason), with the reason", () => {
    const r = suggest(input(visit()));
    expect(tags(r)).toEqual(["high_cost", "near_miss"]);
    expect(r.suggestions.find((s) => s.tag === "high_cost")!.reason).toBe("Rejected for Cost: asked 4.2 vs 3.0 LPA (+40%) · avg 4.1 ≥ 3.5");
  });
  it("threshold is inclusive: 3.5 suggests, 3.49 does not", () => {
    expect(tags(suggest(input(visit({ avg: 3.5 }))))).toContain("high_cost");
    expect(tags(suggest(input(visit({ avg: 3.49 }))))).toEqual([]);
  });
  it("low scorer rejected for cost: nothing (unless they reached the last round)", () => {
    expect(tags(suggest(input(visit({ avg: 2.5 }))))).toEqual([]);
    const r = suggest(input(visit({ avg: 2.5, rounds: [round("HR screen", 2), round("Manager round", 3, LAST)] })));
    expect(tags(r)).toEqual(["near_miss"]);
    expect(r.suggestions[0].reason).toBe("Rejected for Cost / salary expectation (not a skill reason) · reached the last round (Manager round)");
  });
  it("seat filled at the last round: near-miss even with a middling score", () => {
    const r = suggest(input(visit({ category: cat("seat_filled"), avg: 3.0, rounds: [round("Manager round", 3, LAST)] })));
    expect(tags(r)).toEqual(["near_miss"]);
  });
  it("skill-category rejections never suggest, however high the score", () => {
    for (const code of ["knowledge", "communication", "typing_voice", "attitude"]) {
      expect(tags(suggest(input(visit({ category: cat(code), avg: 4.8, rounds: [round("Manager round", 4.8, LAST)] }))))).toEqual([]);
    }
  });
  it("declined offer: near-miss; with cost and a strong score also Good but high cost", () => {
    expect(tags(suggest(input(visit({ outcome: "offer_declined", category: null, avg: 3 }))))).toEqual(["near_miss"]);
    const r = suggest(input(visit({ outcome: "offer_declined", category: cat("cost"), cost: { expected: 450000, budget: 380000 } })));
    expect(tags(r)).toEqual(["high_cost", "near_miss"]);
    expect(r.suggestions.find((s) => s.tag === "high_cost")!.reason).toBe("Declined our offer over Cost: asked 4.5 vs 3.8 LPA (+18%) · avg 4.1 ≥ 3.5");
  });
  it("never for joined employees, Do not rehire, or candidates without scores (says so)", () => {
    expect(tags(suggest(input(visit(), { summary: { lastDecided: visit(), everJoined: true } })))).toEqual([]);
    expect(tags(suggest(input(visit(), { activeTags: ["do_not_rehire"] })))).toEqual([]);
    const r = suggest(input(visit({ avg: null, rounds: [] })));
    expect(r.suggestions).toEqual([]);
    expect(r.note).toBe("No interview scores, so no suggestion.");
    expect(tags(suggest(input(null)))).toEqual([]);
    expect(tags(suggest(input(visit({ outcome: "no_show", category: cat("no_show") }))))).toEqual([]);
  });
  it("a tag the candidate already has is not suggested again", () => {
    expect(tags(suggest(input(visit(), { activeTags: ["high_cost"] })))).toEqual(["near_miss"]);
  });
  it("dismissed stays dismissed for that decision; a new decision brings it back", () => {
    const dismissed = { tag: "high_cost", applicationId: "app1", decidedAt: new Date(decided) };
    expect(tags(suggest(input(visit(), { dismissals: [dismissed] })))).toEqual(["near_miss"]);
    // same visit decided again (override) → new decision time
    expect(tags(suggest(input(visit({ decidedAt: new Date("2026-11-05T08:00:00Z") }), { dismissals: [dismissed] })))).toContain("high_cost");
    // a later visit
    expect(tags(suggest(input(visit({ id: "app2" }), { dismissals: [dismissed] })))).toContain("high_cost");
  });
});

describe("score change", () => {
  const v = (rounds: RoundSummary[]) => ({ rounds, avg: rounds.length ? rounds.reduce((a, r) => a + (r.avg ?? 0), 0) / rounds.length : null });
  it("same rounds compared round by round", () => {
    const c = scoreChange([v([round("HR screen", 3.9)]), v([round("HR screen", 2.8)])])!;
    expect(c).toMatchObject({ delta: 1.1, dir: "up", basis: "same rounds" });
    expect(c.text).toBe("↑ 2.8 → 3.9, +1.1");
  });
  it("only the shared rounds count when one visit went further", () => {
    const c = scoreChange([v([round("HR screen", 3), round("Ops round", 5)]), v([round("HR screen", 3.5)])])!;
    expect(c).toMatchObject({ from: 3.5, to: 3, delta: -0.5, dir: "down", basis: "same rounds" });
  });
  it("different rounds: visit averages, labelled", () => {
    const c = scoreChange([v([round("Ops round", 4)]), v([round("HR screen", 4.04)])])!;
    expect(c.basis).toBe("different rounds");
    expect(c.dir).toBe("flat");
    expect(c.text).toBe("→ 4.0 → 4.0, 0.0 (different rounds)");
    expect(scoreChange([v([round("Ops round", 3.9)]), v([round("HR screen", 2.8)])])!.text).toBe("↑ 2.8 → 3.9, +1.1 (different rounds)");
  });
  it("needs two scored visits", () => {
    expect(scoreChange([v([round("HR screen", 4)])])).toBeNull();
    expect(scoreChange([v([]), v([round("HR screen", 4)])])).toBeNull();
  });
});
