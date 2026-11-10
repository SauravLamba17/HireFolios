import { describe, expect, it } from "vitest";
import { applyDecision, FlowError, mayViewCandidate, nextInterviewStage, outcomeDates, pickNext, queueStage, waitEstimate, type StageInfo } from "./flow";

const st = (id: string, position: number, isInterview: boolean, active = true): StageInfo => ({ id, position, isInterview, active });
// Registered, HR screen, Typing, Ops (inactive), Manager, Offer, Joined
const STAGES = [st("reg", 1, false), st("hr", 2, true), st("typ", 3, true), st("ops", 4, true, false), st("mgr", 5, true), st("offer", 6, false), st("joined", 7, false)];

describe("stage / outcome rules", () => {
  it("new walk-ins at Registered wait for the first interview round", () => {
    expect(queueStage(STAGES, "reg")?.id).toBe("hr");
    expect(queueStage(STAGES, "typ")?.id).toBe("typ");
  });

  it("pass → next active interview round, skipping inactive and non-interview stages", () => {
    expect(applyDecision(STAGES, "hr", "pass")).toEqual({ outcome: "in_progress", stageId: "typ", rejectReason: null });
    expect(applyDecision(STAGES, "typ", "pass")).toEqual({ outcome: "in_progress", stageId: "mgr", rejectReason: null }); // ops is inactive
  });

  it("pass at the last interview round → Selected, moved to the next stage (Offer)", () => {
    expect(applyDecision(STAGES, "mgr", "pass")).toEqual({ outcome: "selected", stageId: "offer", rejectReason: null });
    const noOffer = STAGES.filter((s) => s.position <= 5);
    expect(applyDecision(noOffer, "mgr", "pass")).toEqual({ outcome: "selected", stageId: "mgr", rejectReason: null });
  });

  it("hold → On hold at the same stage", () => {
    expect(applyDecision(STAGES, "typ", "hold")).toEqual({ outcome: "on_hold", stageId: "typ", rejectReason: null });
  });

  it("reject needs a reason", () => {
    expect(applyDecision(STAGES, "hr", "reject", " Typing speed ")).toEqual({ outcome: "rejected", stageId: "hr", rejectReason: "Typing speed" });
    expect(() => applyDecision(STAGES, "hr", "reject", "  ")).toThrow(FlowError);
    expect(() => applyDecision(STAGES, "hr", "reject")).toThrow("Choose a reject reason");
  });

  it("unknown stage is an error, not a silent move", () => {
    expect(() => applyDecision(STAGES, "nope", "pass")).toThrow(FlowError);
    expect(nextInterviewStage(STAGES, "joined")).toBeNull();
  });
});

describe("retention dates", () => {
  const tenant = { dataRetentionDays: 365, photoRetentionDays: 180 };
  const now = new Date("2026-11-10T10:00:00Z");

  it("reject / no show / walked away: decided now, purge after retention", () => {
    for (const o of ["rejected", "no_show", "withdrawn"] as const) {
      const d = outcomeDates(o, now, tenant, false);
      expect(d.decidedAt).toEqual(now);
      expect(d.purgeAfter?.toISOString()).toBe("2027-11-10T10:00:00.000Z");
      expect(d.photoPurgeAfter?.toISOString()).toBe("2027-05-09T10:00:00.000Z");
    }
  });

  it("talent-pool opt-in: decided, but no purge dates", () => {
    expect(outcomeDates("rejected", now, tenant, true)).toEqual({ decidedAt: now, purgeAfter: null, photoPurgeAfter: null });
  });

  it("selected: decided, no purge (they may join); in progress / on hold clear everything", () => {
    expect(outcomeDates("selected", now, tenant, false)).toEqual({ decidedAt: now, purgeAfter: null, photoPurgeAfter: null });
    for (const o of ["in_progress", "on_hold"] as const) expect(outcomeDates(o, now, tenant, false)).toEqual({ decidedAt: null, purgeAfter: null, photoPurgeAfter: null });
  });
});

describe("assign next", () => {
  const at = (iso: string) => new Date(`2026-11-10T${iso}:00+05:30`);
  it("picks whoever waited longest for this round, token breaks ties", () => {
    const w = [
      { applicationId: "c", queuedAt: at("10:05"), token: "A-003" },
      { applicationId: "a", queuedAt: at("10:01"), token: "A-009" },
      { applicationId: "b", queuedAt: at("10:01"), token: "A-002" },
    ];
    expect(pickNext(w)?.applicationId).toBe("b");
    expect(pickNext([])).toBeNull();
  });
});

describe("wait estimate", () => {
  const base = { position: 3, panels: 2, finishedToday: 0, averageToday: null, defaultMinutes: null };
  it('shows "—" (null) until 3 interviews finished today and no default is set', () => {
    expect(waitEstimate(base)).toBeNull();
    expect(waitEstimate({ ...base, finishedToday: 2, averageToday: 12 })).toBeNull();
  });
  it("uses today's real average once 3 have finished: position × avg ÷ panels", () => {
    expect(waitEstimate({ ...base, finishedToday: 3, averageToday: 12 })).toEqual({ minutes: 18, kind: "today" });
    expect(waitEstimate({ ...base, position: 1, finishedToday: 5, averageToday: 0.2 })).toEqual({ minutes: 1, kind: "today" });
  });
  it("falls back to HR's default only if set, labelled an estimate", () => {
    expect(waitEstimate({ ...base, defaultMinutes: 15 })).toEqual({ minutes: 23, kind: "estimate" });
  });
  it("no panel on that round → no number", () => {
    expect(waitEstimate({ ...base, panels: 0, finishedToday: 9, averageToday: 10 })).toBeNull();
  });
});

describe("interviewer access", () => {
  it("interviewers see only candidates assigned to them now or before", () => {
    expect(mayViewCandidate(false, false)).toBe(false);
    expect(mayViewCandidate(false, true)).toBe(true);
    expect(mayViewCandidate(true, false)).toBe(true);
  });
});
