import { describe, expect, it } from "vitest";
import { riskHints, type RiskInput } from "./risk";
import { defaultSettings } from "./settings";

const s = defaultSettings();
const c = (o: Partial<RiskInput> = {}): RiskInput => ({
  outcome: "selected",
  offeredCtc: 350000,
  expectedCtc: 380000,
  noticeDays: 30,
  joiningDate: "2026-11-30",
  city: "Mohali",
  otherOffer: null,
  today: "2026-11-12",
  ...o,
});
const codes = (h: ReturnType<typeof riskHints>) => h.map((x) => x.code);

describe("joining-risk hints", () => {
  it("none when nothing applies (and never for other outcomes)", () => {
    expect(riskHints(c(), s)).toEqual([]);
    expect(riskHints(c({ outcome: "joined", noticeDays: 90 }), s)).toEqual([]);
    expect(riskHints(c({ outcome: "rejected", noticeDays: 90 }), s)).toEqual([]);
  });
  it("other offer + long notice → two hints with their reasons", () => {
    const h = riskHints(c({ noticeDays: 90, otherOffer: { company: "Acme RCM", offeredCtc: 400000, notedOn: "2026-11-02" } }), s);
    expect(codes(h)).toEqual(["other_offer", "notice"]);
    expect(h[0].text).toBe("Other offer in hand: Acme RCM, 4 LPA (noted 02 Nov 2026)");
    expect(h[1].text).toBe("Notice period 90 days (60 or more)");
  });
  it("thresholds at the boundary", () => {
    expect(codes(riskHints(c({ noticeDays: 60 }), s))).toEqual(["notice"]);
    expect(codes(riskHints(c({ noticeDays: 59 }), s))).toEqual([]);
    // 15% over the offer: hint; 14%: none
    expect(riskHints(c({ offeredCtc: 400000, expectedCtc: 460000 }), s)[0].text).toBe("Expects 4.6 LPA, offered 4 LPA (+15%, 15% or more)");
    expect(codes(riskHints(c({ offeredCtc: 400000, expectedCtc: 456000 }), s))).toEqual([]);
    // joining 30 days away: none; 31: hint
    expect(codes(riskHints(c({ joiningDate: "2026-12-12" }), s))).toEqual([]);
    expect(riskHints(c({ joiningDate: "2026-12-13" }), s)[0].text).toBe("Joining 13 Dec 2026, 31 days away (more than 30)");
  });
  it("each rule can be turned off; city only when on and an office city is set", () => {
    const off = { ...s, risk_other_offer_on: false, risk_notice_on: false };
    expect(riskHints(c({ noticeDays: 90, otherOffer: { company: null, offeredCtc: null, notedOn: "2026-11-02" } }), off)).toEqual([]);
    expect(codes(riskHints(c({ city: "Delhi" }), s))).toEqual([]); // off by default
    expect(codes(riskHints(c({ city: "Delhi" }), { ...s, risk_city_mismatch: true }))).toEqual([]); // no office city
    expect(riskHints(c({ city: "Delhi " }), { ...s, risk_city_mismatch: true, office_city: "Mohali" })[0].text).toBe("Lives in Delhi, office in Mohali");
    expect(codes(riskHints(c({ city: "mohali" }), { ...s, risk_city_mismatch: true, office_city: "Mohali" }))).toEqual([]);
  });
  it("no offer CTC or expected CTC: no CTC hint (never guessed)", () => {
    expect(codes(riskHints(c({ offeredCtc: null, expectedCtc: 900000 }), s))).toEqual([]);
    expect(codes(riskHints(c({ expectedCtc: null }), s))).toEqual([]);
  });
});
