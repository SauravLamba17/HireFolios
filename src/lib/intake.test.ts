import { describe, expect, it } from "vitest";
import { ageOn, IntakeDetails, IntakeRequest, latestAdultDob, normalizeMobile } from "./intake";
import { todayIST } from "./ist";
import { formatLpa, lpaToRupees, rupeesToLpa } from "./money";
import { NOTICE_VERSION, noticeText } from "./notice";

describe("normalizeMobile", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["98765 43210", "9876543210"],
    ["+91 98765 43210", "9876543210"],
    ["+91-98765-43210", "9876543210"],
    ["0091 98765 43210", "9876543210"],
    ["919876543210", "9876543210"],
    ["09876543210", "9876543210"],
    ["(987) 654-3210", "9876543210"],
    ["6000000000", "6000000000"],
  ])("accepts %s", (raw, want) => expect(normalizeMobile(raw)).toBe(want));

  it.each(["5876543210", "98765", "98765432101", "+1 9876543210", "+44 9876543210", "abcdefghij", "", "98765 4321O"])("rejects %s", (raw) =>
    expect(normalizeMobile(raw)).toBeNull(),
  );
});

describe("age on the IST calendar day", () => {
  it("turns 18 on the birthday, not the day before", () => {
    expect(ageOn("2008-11-10", "2026-11-10")).toBe(18);
    expect(ageOn("2008-11-10", "2026-11-09")).toBe(17);
    expect(ageOn("2008-02-29", "2026-02-28")).toBe(17);
    expect(ageOn("2008-02-29", "2026-03-01")).toBe(18);
  });
  it("uses India's date, not the server's", () => {
    expect(todayIST(new Date("2026-11-10T19:00:00Z"))).toBe("2026-11-11"); // 00:30 IST next day
    expect(todayIST(new Date("2026-11-10T18:00:00Z"))).toBe("2026-11-10");
  });
  it("date picker max is exactly 18 years back", () => {
    expect(latestAdultDob("2026-11-10")).toBe("2008-11-10");
  });
});

describe("LPA ↔ whole rupees per year", () => {
  it("converts without float drift", () => {
    expect(lpaToRupees(3.5)).toBe(350000);
    expect(lpaToRupees(4.35)).toBe(435000);
    expect(lpaToRupees(0.01)).toBe(1000);
    expect(lpaToRupees(0)).toBe(0);
    expect(rupeesToLpa(350000)).toBe(3.5);
    expect(rupeesToLpa(435000)).toBe(4.35);
    expect(formatLpa(350000)).toBe("3.5 LPA");
    expect(formatLpa(1200000)).toBe("12 LPA");
    expect(formatLpa(null)).toBeNull();
  });
});

const details = (over: Record<string, unknown> = {}) => ({
  jobId: "7d1c0f5e-3a55-4a51-9a49-5b8a0d1e2f30",
  fullName: "  Priya Sharma ",
  dateOfBirth: "1998-04-12",
  email: " Priya@Example.TEST ",
  city: "Mohali",
  education: "B.Sc (Life Sciences)",
  experienceYears: 2,
  experienceMonths: 6,
  currentCtcLpa: 2.4,
  expectedCtcLpa: null,
  noticeDays: 30,
  languages: ["English", "Hindi", "English"],
  source: "Naukri",
  hrNotes: "",
  certifications: ["CPC", "CPC"],
  codingSpecialties: ["E/M"],
  ehrSoftware: ["Epic"],
  nightShiftOk: true,
  voiceProcess: false,
  typingWpm: 35,
  skills: null,
  ...over,
});
const consent = (over: Record<string, unknown> = {}) => ({ agreed: true, language: "hi", noticeVersion: NOTICE_VERSION, talentPool: false, whatsapp: true, ...over });
const firstError = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe("intake schema (shared by tablet and server)", () => {
  it("accepts a full RCM profile and tidies it", () => {
    const r = IntakeRequest.parse({ clientRequestId: crypto.randomUUID(), mobile: "+91 98765-43210", details: details(), consent: consent() });
    expect(r.mobile).toBe("9876543210");
    expect(r.details.fullName).toBe("Priya Sharma");
    expect(r.details.email).toBe("priya@example.test");
    expect(r.details.hrNotes).toBeNull();
    expect(r.details.certifications).toEqual(["CPC"]);
    expect(r.details.languages).toEqual(["English", "Hindi"]);
    expect(r.details.typingWpm).toBe(35);
  });

  it("blocks candidates under 18 (IST today)", () => {
    const next = new Date(`${latestAdultDob()}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const dob17 = next.toISOString().slice(0, 10); // one day short of 18
    expect(firstError(IntakeDetails.safeParse(details({ dateOfBirth: dob17 })))).toMatch(/at least 18/);
    expect(IntakeDetails.safeParse(details({ dateOfBirth: latestAdultDob() })).success).toBe(true);
  });

  it.each([
    [{ dateOfBirth: "2000-02-30" }, /real date/],
    [{ dateOfBirth: "1930-01-01" }, /real date/],
    [{ email: "not-an-email" }, /valid email/],
    [{ jobId: "" }, /position/],
    [{ fullName: "A" }, /full name/],
    [{ education: "PhD in Astrology" }, /education/],
    [{ noticeDays: 21 }, /notice period/],
    [{ certifications: ["CPC", "Made-up cert"] }, /certification/],
    [{ ehrSoftware: ["NotAnEHR"] }, /software/],
    [{ codingSpecialties: ["Dentistry"] }, /specialty/],
    [{ nightShiftOk: null }, /night/],
    [{ voiceProcess: undefined }, /voice/],
    [{ typingWpm: 0 }, /1 to 250/],
    [{ typingWpm: 251 }, /1 to 250/],
    [{ typingWpm: 40.5 }, /whole number/],
    [{ expectedCtcLpa: -1 }, /negative/],
    [{ expectedCtcLpa: 350000 }, /too high/],
    [{ experienceMonths: 12 }, /.+/],
  ])("rejects %o", (over, msg) => {
    expect(firstError(IntakeDetails.safeParse(details(over)))).toMatch(msg);
  });

  it("requires consent and the current notice version", () => {
    const base = { clientRequestId: crypto.randomUUID(), mobile: "9876543210", details: details() };
    expect(firstError(IntakeRequest.safeParse({ ...base, consent: consent({ agreed: false }) }))).toMatch(/consent/i);
    expect(firstError(IntakeRequest.safeParse({ ...base, consent: consent({ noticeVersion: "v0" }) }))).toMatch(/notice changed/);
    expect(IntakeRequest.safeParse({ ...base, consent: consent() }).success).toBe(true);
  });

  it("rejects a bad mobile and a missing idempotency key", () => {
    expect(firstError(IntakeRequest.safeParse({ clientRequestId: crypto.randomUUID(), mobile: "12345", details: details(), consent: consent() }))).toMatch(/10-digit/);
    expect(IntakeRequest.safeParse({ mobile: "9876543210", details: details(), consent: consent() }).success).toBe(false);
  });
});

describe("privacy notice", () => {
  it("has the same parts in English and Hindi, with the tenant's retention", () => {
    const en = noticeText("en", { company: "Acme", photoDays: 180, dataDays: 365 });
    const hi = noticeText("hi", { company: "Acme", photoDays: 180, dataDays: 365 });
    expect(Object.keys(hi)).toEqual(Object.keys(en));
    expect(hi.paragraphs.length).toBe(en.paragraphs.length);
    for (const t of [en, hi]) {
      expect(t.paragraphs.join(" ")).toContain("Acme");
      expect(t.paragraphs.join(" ")).toContain("180");
      expect(t.paragraphs.join(" ")).toContain("365");
    }
    expect(en.paragraphs.join(" ")).toMatch(/Aadhaar/);
  });
});
