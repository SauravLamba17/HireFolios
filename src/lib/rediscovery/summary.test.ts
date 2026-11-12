import { describe, expect, it } from "vitest";
import { categoryForSampleReason, costGap, costText, DEFAULT_CATEGORIES, SAMPLE_REASON_CATEGORY } from "./categories";
import { REJECT_REASONS } from "@/lib/options";
import { cardAverage, fmtScore, summarize, summarizeVisit, type CardInput, type VisitInput } from "./summary";
import { defaultSettings, readSetting, SETTINGS, SETTING_KEYS, SettingsPatch } from "./settings";

const cat = (code: string) => {
  const c = DEFAULT_CATEGORIES.find((x) => x.code === code)!;
  return { code: c.code, label: c.label, kind: c.kind };
};
let n = 0;
const visit = (o: Partial<VisitInput> = {}): VisitInput => ({
  id: `v${++n}`,
  day: "2026-11-01",
  createdAt: new Date("2026-11-01T04:00:00Z"),
  job: "AR Caller",
  outcome: "rejected",
  stage: "Manager round",
  rejectReason: "Salary expectation above budget",
  category: cat("cost"),
  costExpected: 420000,
  costBudget: 300000,
  decidedAt: new Date("2026-11-01T08:00:00Z"),
  offerStatus: null,
  offeredCtc: null,
  joiningDate: null,
  joinedOn: null,
  ...o,
});
const card = (applicationId: string, stage: [string, number], scores: Record<string, number>, o: Partial<CardInput> = {}): CardInput => ({
  applicationId,
  stageId: `s-${stage[0]}`,
  stageName: stage[0],
  stagePosition: stage[1],
  interviewer: "Iva",
  scores,
  overall: null,
  comments: null,
  at: new Date("2026-11-01T06:00:00Z"),
  ...o,
});
const HR: [string, number] = ["HR screen", 2];
const OPS: [string, number] = ["Ops round", 3];
const MGR: [string, number] = ["Manager round", 4];

describe("reject categories", () => {
  it("maps every sample reject reason to a category that exists", () => {
    const codes = DEFAULT_CATEGORIES.map((c) => c.code);
    for (const r of REJECT_REASONS) expect(codes).toContain(categoryForSampleReason(r));
    expect(Object.keys(SAMPLE_REASON_CATEGORY).sort()).toEqual([...REJECT_REASONS].sort());
    expect(categoryForSampleReason("Something HR added")).toBe("other");
  });
  it("kinds follow the spec", () => {
    const kind = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.code, c.kind]));
    expect(["cost", "shift_location", "notice_timing", "seat_filled"].map((c) => kind[c])).toEqual(Array(4).fill("non_skill"));
    expect(["knowledge", "communication", "typing_voice", "attitude"].map((c) => kind[c])).toEqual(Array(4).fill("skill"));
    expect(["documents", "no_show", "other"].map((c) => kind[c])).toEqual(Array(3).fill("neutral"));
  });
});

describe("cost gap", () => {
  it("LPA and percent of the budget", () => {
    expect(costGap(420000, 300000)).toEqual({ expected: 420000, budget: 300000, gapRupees: 120000, gapPercent: 40 });
    expect(costText({ expected: 420000, budget: 300000 })).toBe("asked 4.2 vs budget 3.0 LPA (+40%)");
    expect(costText({ expected: 380000, budget: 400000 })).toBe("asked 3.8 vs budget 4.0 LPA (-5%)");
    expect(costText({ expected: 450000, budget: 380000 }, "offered")).toBe("asked 4.5 vs offered 3.8 LPA (+18%)");
  });
  it("says what is missing instead of guessing", () => {
    expect(costText({ expected: 420000, budget: null })).toBe("asked 4.2 LPA, budget not recorded");
    expect(costText({ expected: null, budget: 300000 })).toBe("budget 3.0 LPA, ask not recorded");
    expect(costText({ expected: null, budget: null })).toBe("no figures recorded");
    expect(costGap(400000, 0).gapPercent).toBeNull();
  });
});

describe("hiring summary", () => {
  it("not hired for cost: the spec's one-line text", () => {
    const v = visit();
    const s = summarizeVisit(v, [card(v.id, HR, { Communication: 4, Knowledge: 4 }), card(v.id, MGR, { Communication: 4, Knowledge: 4.2 })]);
    expect(s.status).toBe("not_hired");
    expect(s.rounds.map((r) => r.name)).toEqual(["HR screen", "Manager round"]);
    expect(fmtScore(s.avg)).toBe("4.1");
    expect(s.line).toBe("Not hired — Cost / salary expectation: asked 4.2 vs budget 3.0 LPA (+40%) · reached Manager round · avg 4.1/5");
  });
  it("every status", () => {
    const st = (o: Partial<VisitInput>) => summarizeVisit(visit(o), []);
    expect(st({ outcome: "joined", joinedOn: "2026-12-01" }).line).toBe("Hired — joined 01 Dec 2026 · no interview scores");
    expect(st({ outcome: "selected" }).statusLabel).toBe("Selected");
    expect(st({ outcome: "selected", offerStatus: "offered", offeredCtc: 360000, joiningDate: "2026-12-01" }).line).toBe("Offered — offer offered at 3.6 LPA, joining 01 Dec 2026 · no interview scores");
    expect(st({ outcome: "no_show", category: cat("no_show") }).line).toBe("Didn't finish — No show · no interview scores");
    expect(st({ outcome: "withdrawn" }).reason).toBe("Walked away");
    expect(st({ outcome: "offer_declined", category: cat("cost"), costExpected: 450000, costBudget: 380000 }).line).toBe(
      "Didn't finish — Offer declined (Cost / salary expectation: asked 4.5 vs offered 3.8 LPA (+18%)) · no interview scores",
    );
    expect(st({ outcome: "offer_declined", category: null }).reason).toBe("Offer declined");
    expect(st({ outcome: "in_progress", stage: "HR screen" }).line).toBe("In progress — HR screen");
    expect(st({ outcome: "on_hold", stage: "Ops round" }).status).toBe("on_hold");
  });
  it("skill rejection names category and reason; missing budget is said", () => {
    expect(summarizeVisit(visit({ category: cat("knowledge"), rejectReason: "No relevant RCM experience" }), []).reason).toBe("Knowledge / skills: No relevant RCM experience");
    expect(summarizeVisit(visit({ costBudget: null }), []).reason).toBe("Cost / salary expectation: asked 4.2 LPA, budget not recorded");
    expect(summarizeVisit(visit({ category: null, rejectReason: "Old reason" }), []).reason).toBe("Old reason");
  });
  it("averages: card → round → visit → overall; overall field when a card has no criteria", () => {
    expect(cardAverage({ scores: {}, overall: 3 })).toBe(3);
    expect(cardAverage({ scores: { a: 2, b: 5 }, overall: 4 })).toBe(3.5);
    const v = visit();
    const s = summarizeVisit(v, [card(v.id, HR, { a: 2, b: 4 }), card(v.id, HR, { a: 4, b: 4 }, { interviewer: "Ravi" }), card(v.id, OPS, {}, { overall: 5 })]);
    expect(s.rounds.map((r) => r.avg)).toEqual([3.5, 5]);
    expect(s.avg).toBe(4.25);
  });
  it("strongest / weakest criterion and notes latest first", () => {
    const v = visit();
    const s = summarizeVisit(v, [
      card(v.id, HR, { Communication: 5, Typing: 2 }, { comments: "Good voice", at: new Date("2026-11-01T05:00:00Z") }),
      card(v.id, OPS, { Communication: 4, Knowledge: 3 }, { comments: "  Knows denials ", at: new Date("2026-11-01T07:00:00Z") }),
    ]);
    expect(s.strongest).toEqual({ label: "Communication", avg: 4.5 });
    expect(s.weakest).toEqual({ label: "Typing", avg: 2 });
    expect(s.notes.map((x) => x.text)).toEqual(["Knows denials", "Good voice"]);
    expect(summarizeVisit(v, [card(v.id, HR, { a: 3, b: 3 })]).strongest).toBeNull();
  });
  it("partial rounds, several visits (same day too), different positions; latest first", () => {
    const a = visit({ day: "2026-06-01", decidedAt: new Date("2026-06-01T08:00:00Z"), job: "Medical Coder", outcome: "rejected", category: cat("knowledge"), rejectReason: "Failed assessment / test" });
    const b = visit({ day: "2026-11-01", createdAt: new Date("2026-11-01T04:00:00Z"), job: "AR Caller", outcome: "no_show", category: cat("no_show"), decidedAt: new Date("2026-11-01T05:00:00Z") });
    const c = visit({ day: "2026-11-01", createdAt: new Date("2026-11-01T06:00:00Z"), job: "Payment Poster", outcome: "in_progress", stage: "HR screen", decidedAt: null });
    const s = summarize([a, b, c], [card(a.id, HR, { x: 2, y: 3 })]);
    expect(s.visits.map((v) => v.job)).toEqual(["Payment Poster", "AR Caller", "Medical Coder"]);
    expect(s.latest!.status).toBe("in_progress");
    expect(s.lastDecided!.id).toBe(b.id);
    expect(s.line).toBe("In progress — HR screen · 3 visits");
    expect(s.overallAvg).toBe(2.5);
    expect(s.everJoined).toBe(false);
  });
  it("works on what retention left: no visits, or visits without scorecards", () => {
    expect(summarize([], []).line).toBe("No visits");
    const s = summarize([visit()], []);
    expect(s.latest!.line).toContain("no interview scores");
    expect(s.overallAvg).toBeNull();
  });
});

describe("rediscovery settings", () => {
  it("defaults are inside their limits", () => {
    const d = defaultSettings();
    for (const k of SETTING_KEYS) expect(readSetting(k, d[k])).toEqual(d[k]);
    expect(d.score_threshold).toBe(3.5);
    expect([d.contact_cooling_days, d.talent_pool_keep_months, d.callback_default_days, d.risk_notice_days, d.risk_ctc_gap_percent, d.risk_joining_days, d.bulk_recency_months]).toEqual([30, 24, 30, 60, 15, 30, 24]);
    expect(d.risk_city_mismatch).toBe(false);
  });
  it("patches are checked against the limits, unknown keys refused", () => {
    expect(SettingsPatch.safeParse({ score_threshold: 4.2, wa_bulk_en: "Hi {name}" }).success).toBe(true);
    expect(SettingsPatch.safeParse({ score_threshold: 5.5 }).success).toBe(false);
    expect(SettingsPatch.safeParse({ contact_cooling_days: 2.5 }).success).toBe(false);
    expect(SettingsPatch.safeParse({ wa_bulk_en: "  " }).success).toBe(false);
    expect(SettingsPatch.safeParse({ nope: 1 }).success).toBe(false);
    expect(SettingsPatch.safeParse({}).success).toBe(false);
    expect(SettingsPatch.safeParse({ office_city: "" }).success).toBe(true);
  });
  it("a stored value outside the limits falls back to the default", () => {
    expect(readSetting("score_threshold", 9)).toBe(SETTINGS.score_threshold.default);
    expect(readSetting("risk_city_mismatch", "yes")).toBe(false);
  });
});
