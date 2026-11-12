// Joining-risk hints (pure, unit-tested): plain-language reasons a selected / offered candidate might not join.
// Never a single score, never changes an outcome; each rule can be turned off in Settings. docs/REDISCOVERY.md F.
import { formatDayIST } from "@/lib/ist";
import { formatLpa } from "@/lib/money";
import { daysSinceIST } from "@/lib/rediscovery/contact";
import type { RediscoverySettings } from "@/lib/rediscovery/settings";

export type RiskCode = "other_offer" | "notice" | "ctc_gap" | "joining_far" | "city";
export const RISK_LABELS: Record<RiskCode, string> = {
  other_offer: "Other offer in hand",
  notice: "Long notice period",
  ctc_gap: "Expected CTC above offer",
  joining_far: "Joining date far away",
  city: "Lives in another city",
};
export type RiskHint = { code: RiskCode; text: string };

export type RiskInput = {
  outcome: string;
  offeredCtc: number | null;
  expectedCtc: number | null;
  noticeDays: number | null;
  joiningDate: string | null;
  city: string | null;
  otherOffer: { company: string | null; offeredCtc: number | null; notedOn: string } | null;
  today: string;
};

type RiskSettings = Pick<
  RediscoverySettings,
  "risk_other_offer_on" | "risk_notice_on" | "risk_notice_days" | "risk_ctc_on" | "risk_ctc_gap_percent" | "risk_joining_on" | "risk_joining_days" | "risk_city_mismatch" | "office_city"
>;

const daysBetween = (from: string, to: string) => -daysSinceIST(new Date(`${to}T12:00:00+05:30`), new Date(`${from}T12:00:00+05:30`));

/** Hints for a selected (offered or not) candidate who has not joined; none for any other outcome. */
export function riskHints(c: RiskInput, s: RiskSettings): RiskHint[] {
  if (c.outcome !== "selected") return [];
  const out: RiskHint[] = [];
  if (s.risk_other_offer_on && c.otherOffer) {
    const o = c.otherOffer;
    out.push({ code: "other_offer", text: `Other offer in hand: ${[o.company ?? "company not given", o.offeredCtc !== null && formatLpa(o.offeredCtc)].filter(Boolean).join(", ")} (noted ${formatDayIST(o.notedOn)})` });
  }
  if (s.risk_notice_on && c.noticeDays !== null && c.noticeDays >= s.risk_notice_days) {
    out.push({ code: "notice", text: `Notice period ${c.noticeDays} days (${s.risk_notice_days} or more)` });
  }
  if (s.risk_ctc_on && c.offeredCtc && c.expectedCtc !== null) {
    const gap = Math.round(((c.expectedCtc - c.offeredCtc) / c.offeredCtc) * 100);
    if (gap >= s.risk_ctc_gap_percent) out.push({ code: "ctc_gap", text: `Expects ${formatLpa(c.expectedCtc)}, offered ${formatLpa(c.offeredCtc)} (+${gap}%, ${s.risk_ctc_gap_percent}% or more)` });
  }
  if (s.risk_joining_on && c.joiningDate) {
    const days = daysBetween(c.today, c.joiningDate);
    if (days > s.risk_joining_days) out.push({ code: "joining_far", text: `Joining ${formatDayIST(c.joiningDate)}, ${days} days away (more than ${s.risk_joining_days})` });
  }
  const office = s.office_city.trim().toLowerCase();
  if (s.risk_city_mismatch && office && c.city && c.city.trim().toLowerCase() !== office) {
    out.push({ code: "city", text: `Lives in ${c.city.trim()}, office in ${s.office_city.trim()}` });
  }
  return out;
}
