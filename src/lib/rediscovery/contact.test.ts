import { describe, expect, it } from "vitest";
import { candidateErasable, keepText, photoErasable, poolKeptUntil } from "@/lib/retention";
import { addDays, callbackReason, coolingWarning, daysSinceIST, defaultCallbackDay, renderTemplate, renderTemplates, telLink, waLink, whatsappAllowed } from "./contact";
import { defaultSettings } from "./settings";

const now = new Date("2026-11-12T10:00:00+05:30");
const ago = (days: number, hour = 10) => new Date(new Date(`2026-11-12T${String(hour).padStart(2, "0")}:00:00+05:30`).getTime() - days * 864e5);

describe("cooling period", () => {
  it("29 days → warning, 30 and 31 → none (30-day cooling)", () => {
    expect(coolingWarning({ at: ago(29), by: "Asha", channel: "call" }, 30, now)?.text).toBe("Contacted 29 days ago by Asha — contact again?");
    expect(coolingWarning({ at: ago(30), by: "Asha", channel: "call" }, 30, now)).toBeNull();
    expect(coolingWarning({ at: ago(31), by: "Asha", channel: "call" }, 30, now)).toBeNull();
  });
  it("counts IST calendar days, not hours; today / yesterday in words", () => {
    expect(daysSinceIST(new Date("2026-11-11T23:30:00+05:30"), new Date("2026-11-12T00:15:00+05:30"))).toBe(1);
    expect(coolingWarning({ at: ago(0, 9), by: null, channel: "call" }, 30, now)?.text).toBe("Contacted today by a colleague — contact again?");
    expect(coolingWarning({ at: ago(1), by: "Ravi", channel: "whatsapp" }, 30, now)?.days).toBe(1);
    expect(coolingWarning(null, 30, now)).toBeNull();
    expect(coolingWarning({ at: ago(0), by: "Ravi", channel: "call" }, 0, now)).toBeNull(); // 0 = off
  });
});

describe("WhatsApp and calls", () => {
  it("templates render EN and HI with the four placeholders; others stay", () => {
    const v = { name: "Priya", company: "Simplen", position: "AR Caller", hr_name: "Asha" };
    const d = defaultSettings();
    expect(renderTemplate(d.wa_bulk_en, v)).toBe(
      "Hello Priya, this is Asha from Simplen. We have new openings for AR Caller. You visited us before and we would like to invite you again. Reply here or call us if you are interested.",
    );
    const hi = renderTemplate(d.wa_bulk_hi, v);
    expect(hi).toContain("नमस्ते Priya");
    expect(hi).toContain("Simplen से Asha");
    expect(hi).toContain("AR Caller के लिए");
    expect(hi).not.toMatch(/\{(name|company|position|hr_name)\}/);
    expect(renderTemplate("{name} {salary}", v)).toBe("Priya {salary}");
    const all = renderTemplates(d, v, "callback");
    expect(all.map((t) => t.id)).toEqual(["wa_callback_en", "wa_callback_hi", "wa_bulk_en", "wa_bulk_hi", "wa_consent_en", "wa_consent_hi"]);
  });
  it("links: +91, text encoded", () => {
    expect(waLink("9876543210", "Hi Priya & co")).toBe("https://wa.me/919876543210?text=Hi%20Priya%20%26%20co");
    expect(telLink("9876543210")).toBe("tel:+919876543210");
  });
  it("WhatsApp only with a WhatsApp consent that is not withdrawn", () => {
    expect(whatsappAllowed(null)).toBe(false);
    expect(whatsappAllowed({ whatsapp: false, withdrawnAt: null })).toBe(false);
    expect(whatsappAllowed({ whatsapp: true, withdrawnAt: null })).toBe(true);
    expect(whatsappAllowed({ whatsapp: true, withdrawnAt: now })).toBe(false);
  });
});

describe("call-backs", () => {
  it("default date = decision day + notice days; none / immediate → the default", () => {
    expect(defaultCallbackDay("2026-11-12", 30, 30)).toBe("2026-12-12");
    expect(defaultCallbackDay("2026-11-12", 60, 30)).toBe("2027-01-11");
    expect(defaultCallbackDay("2026-11-12", null, 45)).toBe("2026-12-27");
    expect(defaultCallbackDay("2026-11-12", 0, 30)).toBe("2026-12-12");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("offered after timing / shift reasons and holds", () => {
    expect(callbackReason("rejected", "notice_timing", "Notice period / timing")).toBe("Notice period / timing");
    expect(callbackReason("rejected", "shift_location", null)).toBe("shift_location");
    expect(callbackReason("on_hold", null, null)).toBe("On hold");
    expect(callbackReason("rejected", "cost", "Cost")).toBeNull();
  });
});

describe("talent pool keep period and deletion", () => {
  const past = new Date(now.getTime() - 864e5);
  const v = (outcome: Parameters<typeof photoErasable>[0]["outcome"], purgeAfter: Date | null = null) => ({ outcome, purgeAfter, photoPurgeAfter: purgeAfter });
  it("keep date = later of last visit and consent, plus the months", () => {
    expect(poolKeptUntil("2026-01-10", new Date("2025-12-01T00:00:00Z"), 24)!.toISOString()).toBe(new Date("2028-01-10T00:00:00+05:30").toISOString());
    expect(poolKeptUntil("2025-01-10", new Date("2026-03-05T06:30:00Z"), 24)!.toISOString()).toBe("2028-03-05T06:30:00.000Z"); // renewal counts
    expect(poolKeptUntil(null, null, 24)).toBeNull();
  });
  it("consent keeps a rejected candidate past retention until the keep period ends", () => {
    expect(candidateErasable([v("rejected", null)], true, now)).toBe(false); // in the pool, period running
    expect(candidateErasable([v("rejected", null)], true, now, true)).toBe(true); // period over
    expect(candidateErasable([v("rejected", null), v("in_progress")], true, now, true)).toBe(false); // open visit keeps them
    expect(candidateErasable([v("joined")], true, now, true)).toBe(false);
    expect(photoErasable(v("rejected", past), true, now)).toBe(false);
  });
  it("tags never keep data: without consent the normal dates apply", () => {
    expect(candidateErasable([v("rejected", past)], false, now)).toBe(true);
  });
  it("profile text says why data is kept or when it goes", () => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    expect(keepText([v("joined")], { inPool: false, until: null }, fmt)).toBe("Kept (employee record)");
    expect(keepText([v("rejected")], { inPool: true, until: new Date("2028-01-10T00:00:00Z") }, fmt)).toBe("Kept (talent-pool consent until 2028-01-10)");
    expect(keepText([v("rejected", new Date("2027-11-12T00:00:00Z")), v("no_show", new Date("2027-05-01T00:00:00Z"))], { inPool: false, until: null }, fmt)).toBe("Data deletes on 2027-11-12");
    expect(keepText([v("in_progress")], { inPool: false, until: null }, fmt)).toBe("Kept while a visit is open or undecided");
  });
});
