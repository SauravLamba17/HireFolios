import { describe, expect, it } from "vitest";
import { byRank, overBudget, rank, type BulkCriteria, type RankInput } from "./rank";

const W = { budget: 30, score: 25, skills: 20, shift: 10, improvement: 5, recency: 10 };
const opts = { today: "2026-11-12", recencyMonths: 24, overBudgetLimit: 10 };
const k = (o: Partial<BulkCriteria> = {}): BulkCriteria => ({ budget: 400000, certifications: [], software: [], minExperienceMonths: null, night: false, voice: false, ...o });
const c = (o: Partial<RankInput> = {}): RankInput => ({
  expectedCtc: 380000,
  avg: 4.2,
  delta: null,
  certifications: ["CPC"],
  software: ["Epic"],
  experienceMonths: 24,
  nightShiftOk: true,
  voiceProcess: true,
  lastVisitDay: "2026-10-12",
  source: "Cost reject",
  ...o,
});

describe("bulk ranking", () => {
  it("says why in words (the spec's example)", () => {
    const r = rank(c(), k({ certifications: ["CPC"], software: ["Epic"], night: true }), W, opts);
    expect(r.why).toBe("Cost reject · asked 3.8 ≤ budget 4.0 · avg 4.2 · CPC · Epic · night OK");
    expect(r.parts).toMatchObject({ budget: 1, skills: 1, shift: 1, improvement: 0.5 });
  });
  it("budget boundary: equal is within; slightly over is lower and labelled; half at the limit", () => {
    expect(rank(c({ expectedCtc: 400000 }), k(), W, opts).parts.budget).toBe(1);
    const over = rank(c({ expectedCtc: 420000 }), k(), W, opts);
    expect(over.overBudgetPercent).toBe(5);
    expect(over.parts.budget).toBeCloseTo(0.75);
    expect(over.why).toContain("+5% over budget (asked 4.2)");
    expect(rank(c({ expectedCtc: 440000 }), k(), W, opts).parts.budget).toBe(0.5); // at the limit (more is left out by the list)
    expect(rank(c({ expectedCtc: null }), k(), W, opts).parts.budget).toBe(0.5);
    expect(rank(c(), k({ budget: null }), W, opts).parts.budget).toBe(1);
    expect(overBudget(420000, 300000)).toBe(40);
    expect(overBudget(null, 300000)).toBeNull();
  });
  it("orders fixed fixtures: in budget + strong first, over budget lower, weak last", () => {
    const people = [
      { name: "weak", ...c({ avg: 2.0 }) },
      { name: "over", ...c({ expectedCtc: 430000, avg: 4.5 }) },
      { name: "best", ...c({ avg: 4.6, delta: 0.8 }) },
      { name: "good", ...c({ avg: 4.0, lastVisitDay: "2025-06-01" }) },
    ].map((p) => ({ ...p, ranked: rank(p, k(), W, opts), avg: p.avg }));
    expect(people.sort(byRank).map((p) => p.name)).toEqual(["best", "good", "over", "weak"]);
  });
  it("missing certifications / software / experience and shift are said and count", () => {
    const r = rank(c({ certifications: [], software: ["Epic"], experienceMonths: 6, nightShiftOk: false, voiceProcess: null }), k({ certifications: ["CPC"], software: ["Epic"], minExperienceMonths: 12, night: true, voice: true }), W, opts);
    expect(r.why).toContain("no CPC");
    expect(r.why).toContain("less experience than asked");
    expect(r.why).toContain("no night shift");
    expect(r.why).toContain("voice not asked");
    expect(r.parts.skills).toBeCloseTo(1 / 3);
    expect(r.parts.shift).toBe(0.25);
  });
  it("improvement and recency", () => {
    expect(rank(c({ delta: 1 }), k(), W, opts).parts.improvement).toBe(1);
    expect(rank(c({ delta: -1.5 }), k(), W, opts).parts.improvement).toBe(0);
    expect(rank(c({ delta: 1.1 }), k(), W, opts).why).toContain("score ↑ +1.1");
    expect(rank(c({ lastVisitDay: "2024-11-12" }), k(), W, opts).parts.recency).toBe(0);
    expect(rank(c({ avg: null }), k(), W, opts).why).toContain("no scores");
  });
  it("weights: all zero gives 0, one weight alone decides", () => {
    expect(rank(c(), k(), { budget: 0, score: 0, skills: 0, shift: 0, improvement: 0, recency: 0 }, opts).score).toBe(0);
    expect(rank(c({ avg: 5 }), k(), { budget: 0, score: 1, skills: 0, shift: 0, improvement: 0, recency: 0 }, opts).score).toBe(100);
  });
});
