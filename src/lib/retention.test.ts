import { describe, expect, it } from "vitest";
import { candidateErasable, dsrDueAt, dsrOverdue, photoErasable, recalculatedDates, retentionProblem } from "./retention";

const now = new Date("2026-11-11T12:00:00Z");
const past = new Date("2026-11-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");
const v = (outcome: string, purgeAfter: Date | null, photoPurgeAfter: Date | null = purgeAfter) =>
  ({ outcome, purgeAfter, photoPurgeAfter }) as Parameters<typeof photoErasable>[0];

describe("which candidates the deletion job may erase", () => {
  it("rejected long ago, no talent pool, single visit → erase", () => {
    expect(candidateErasable([v("rejected", past)], false, now)).toBe(true);
    expect(candidateErasable([v("no_show", past), v("withdrawn", past), v("offer_declined", past)], false, now)).toBe(true);
  });
  it("purge date still in the future → keep", () => {
    expect(candidateErasable([v("rejected", future)], false, now)).toBe(false);
  });
  it("exactly at the purge time → erase (date has been reached)", () => {
    expect(candidateErasable([v("rejected", now)], false, now)).toBe(true);
  });
  it("talent pool → keep, whatever the dates", () => {
    expect(candidateErasable([v("rejected", past)], true, now)).toBe(false);
  });
  it("joined → keep forever, even with an old purge date on another visit", () => {
    expect(candidateErasable([v("rejected", past), v("joined", null)], false, now)).toBe(false);
    expect(candidateErasable([v("joined", past)], false, now)).toBe(false);
  });
  it("a newer visit (in progress, on hold, selected, or a later purge date) → keep", () => {
    expect(candidateErasable([v("rejected", past), v("in_progress", null)], false, now)).toBe(false);
    expect(candidateErasable([v("rejected", past), v("on_hold", null)], false, now)).toBe(false);
    expect(candidateErasable([v("rejected", past), v("selected", null)], false, now)).toBe(false);
    expect(candidateErasable([v("rejected", past), v("rejected", future)], false, now)).toBe(false);
  });
  it("no visits → nothing to decide on, keep", () => {
    expect(candidateErasable([], false, now)).toBe(false);
  });
});

describe("which photos may go early", () => {
  it("photo date passed → delete the photo (rest stays until its own date)", () => {
    expect(photoErasable(v("rejected", future, past), false, now)).toBe(true);
  });
  it("never for talent pool, joined, or a future / missing photo date", () => {
    expect(photoErasable(v("rejected", future, past), true, now)).toBe(false);
    expect(photoErasable(v("joined", null, past), false, now)).toBe(false);
    expect(photoErasable(v("rejected", future, future), false, now)).toBe(false);
    expect(photoErasable(v("in_progress", null, null), false, now)).toBe(false);
  });
});

describe("retention settings", () => {
  const ok = { cooldownDays: 90, photoRetentionDays: 180, dataRetentionDays: 365 };
  it("accepts sensible values, refuses out-of-range ones", () => {
    expect(retentionProblem(ok)).toBeNull();
    expect(retentionProblem({ ...ok, photoRetentionDays: 10 })).toMatch(/30 to 3650/);
    expect(retentionProblem({ ...ok, dataRetentionDays: 5000 })).toMatch(/30 to 3650/);
    expect(retentionProblem({ ...ok, cooldownDays: -1 })).toMatch(/0 to 365/);
    expect(retentionProblem({ ...ok, cooldownDays: 1.5 })).toMatch(/whole number/);
  });
  it("photos can't outlive the data", () => {
    expect(retentionProblem({ ...ok, photoRetentionDays: 400 })).toMatch(/longer than/);
  });
  it("re-calculation uses the decision time and the new days; talent pool / undecided stay empty", () => {
    const decidedAt = new Date("2026-01-01T00:00:00Z");
    const r = recalculatedDates({ outcome: "rejected", decidedAt }, { dataRetentionDays: 100, photoRetentionDays: 30 }, false);
    expect(r.purgeAfter?.toISOString()).toBe("2026-04-11T00:00:00.000Z");
    expect(r.photoPurgeAfter?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(recalculatedDates({ outcome: "rejected", decidedAt }, { dataRetentionDays: 100, photoRetentionDays: 30 }, true)).toEqual({ purgeAfter: null, photoPurgeAfter: null });
    expect(recalculatedDates({ outcome: "joined", decidedAt }, { dataRetentionDays: 100, photoRetentionDays: 30 }, false)).toEqual({ purgeAfter: null, photoPurgeAfter: null });
    expect(recalculatedDates({ outcome: "in_progress", decidedAt: null }, { dataRetentionDays: 100, photoRetentionDays: 30 }, false)).toEqual({ purgeAfter: null, photoPurgeAfter: null });
  });
});

describe("rights requests", () => {
  it("due 90 days after receipt; overdue only while still open", () => {
    const received = new Date("2026-08-01T10:00:00Z");
    const due = dsrDueAt(received);
    expect(due.toISOString()).toBe("2026-10-30T10:00:00.000Z");
    expect(dsrOverdue({ dueAt: due, status: "open" }, now)).toBe(true);
    expect(dsrOverdue({ dueAt: due, status: "in_progress" }, now)).toBe(true);
    expect(dsrOverdue({ dueAt: due, status: "completed" }, now)).toBe(false);
    expect(dsrOverdue({ dueAt: dsrDueAt(now), status: "open" }, now)).toBe(false);
  });
});
