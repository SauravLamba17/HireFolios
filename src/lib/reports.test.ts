import { describe, expect, it } from "vitest";
import { barWidths, daysBetween, fillDays, minutesLabel, parseRange, rate } from "./reports";

describe("report date range", () => {
  it("defaults to the last 30 days up to today (IST day)", () => {
    expect(parseRange({}, "2026-11-11")).toEqual({ from: "2026-10-13", to: "2026-11-11" });
    expect(daysBetween("2026-10-13", "2026-11-11")).toHaveLength(30);
  });
  it("keeps a valid range, fixes bad / reversed / future input", () => {
    expect(parseRange({ from: "2026-11-01", to: "2026-11-05" }, "2026-11-11")).toEqual({ from: "2026-11-01", to: "2026-11-05" });
    expect(parseRange({ from: "2026-11-09", to: "2026-11-01" }, "2026-11-11")).toEqual({ from: "2026-10-03", to: "2026-11-01" });
    expect(parseRange({ from: "nope", to: "2027-01-01" }, "2026-11-11")).toEqual({ from: "2026-10-13", to: "2026-11-11" });
    expect(parseRange({ from: "2026-02-30" }, "2026-11-11").from).toBe("2026-10-13");
  });
  it("caps very long ranges at 366 days", () => {
    const r = parseRange({ from: "2020-01-01", to: "2026-11-11" }, "2026-11-11");
    expect(daysBetween(r.from, r.to)).toHaveLength(366);
  });
});

describe("report numbers", () => {
  it("fills days without walk-ins with zero", () => {
    expect(fillDays("2026-11-01", "2026-11-03", [{ day: "2026-11-02", n: 4 }])).toEqual([
      { day: "2026-11-01", n: 0 },
      { day: "2026-11-02", n: 4 },
      { day: "2026-11-03", n: 0 },
    ]);
  });
  it("rates: whole percent, none when nothing to divide by", () => {
    expect(rate(1, 3)).toBe(33);
    expect(rate(2, 3)).toBe(67);
    expect(rate(0, 0)).toBeNull();
  });
  it("minutes read naturally", () => {
    expect(minutesLabel(null)).toBe("—");
    expect(minutesLabel(12.4)).toBe("12 min");
    expect(minutesLabel(65)).toBe("1 h 5 min");
    expect(minutesLabel(120)).toBe("2 h");
    expect(minutesLabel(60 * 24 * 3)).toBe("3 days");
  });
  it("bars scale to the largest value", () => {
    expect(barWidths([{ n: 2 }, { n: 4 }, { n: 0 }]).map((b) => b.pct)).toEqual([50, 100, 0]);
    expect(barWidths([{ n: 0 }]).map((b) => b.pct)).toEqual([0]);
  });
});
