// Contact etiquette (pure, browser-safe, unit-tested): cooling period, WhatsApp / call links, templates, call-back
// dates. docs/REDISCOVERY.md section D. No messages are sent by the app: wa.me / tel: links only open the HR PC's apps.
import { todayIST } from "@/lib/ist";
import { SETTINGS, type RediscoverySettings } from "@/lib/rediscovery/settings";

export const CHANNELS = { call: "Call", whatsapp: "WhatsApp", other: "Other (in person, email…)" } as const;
export const PURPOSES = { callback: "Call-back", bulk_push: "Bulk push", consent: "Consent request", other: "Other" } as const;
export const CONTACT_OUTCOMES = { no_answer: "No answer", interested: "Interested", not_interested: "Not interested", call_later: "Call later", wrong_number: "Wrong number" } as const;
export const CONSENT_CHANNELS = { in_person: "In person", whatsapp: "WhatsApp", phone: "Phone", email: "Email" } as const;
export type Channel = keyof typeof CHANNELS;
export type Purpose = keyof typeof PURPOSES;
export type ContactOutcome = keyof typeof CONTACT_OUTCOMES;
export type ConsentChannel = keyof typeof CONSENT_CHANNELS;

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;

/** Whole IST calendar days from `at` to `now` (contacted yesterday evening = 1, whatever the hour). */
export const daysSinceIST = (at: Date, now = new Date()) => dayNumber(todayIST(now)) - dayNumber(todayIST(at));

/** YYYY-MM-DD plus whole days (calendar arithmetic, no time zone involved). */
export function addDays(day: string, days: number) {
  return new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10);
}

export type LastContact = { at: Date; by: string | null; channel: string };

/** Soft warning when the last contact is fewer than `coolingDays` days ago (29 of 30 → warn; 30 → no warning). */
export function coolingWarning(last: LastContact | null, coolingDays: number, now = new Date()): { days: number; text: string } | null {
  if (!last) return null;
  const days = daysSinceIST(last.at, now);
  if (days >= coolingDays) return null;
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return { days, text: `Contacted ${when} by ${last.by ?? "a colleague"} — contact again?` };
}

export type TemplateVars = { name: string; company: string; position: string; hr_name: string };
/** {name} {company} {position} {hr_name}; anything else in braces stays as typed. */
export const renderTemplate = (text: string, v: TemplateVars) => text.replace(/\{(name|company|position|hr_name)\}/g, (_, k: keyof TemplateVars) => v[k]);

const TEMPLATE_KEYS = { bulk: ["wa_bulk_en", "wa_bulk_hi"], callback: ["wa_callback_en", "wa_callback_hi"], consent: ["wa_consent_en", "wa_consent_hi"] } as const;

/** The six WhatsApp templates rendered for one person, the purpose's own two first. */
export function renderTemplates(s: RediscoverySettings, v: TemplateVars, first: keyof typeof TEMPLATE_KEYS) {
  const order = [first, ...(Object.keys(TEMPLATE_KEYS) as (keyof typeof TEMPLATE_KEYS)[]).filter((k) => k !== first)];
  return order.flatMap((k) => TEMPLATE_KEYS[k].map((key) => ({ id: key, label: SETTINGS[key].label, text: renderTemplate(s[key], v) })));
}

/** Stored mobiles are 10 digits; click-to-chat and dialling need +91. */
export const waLink = (mobile: string, text: string) => `https://wa.me/91${mobile}?text=${encodeURIComponent(text)}`;
export const telLink = (mobile: string) => `tel:+91${mobile}`;

/** WhatsApp only when the latest consent (not withdrawn) said yes to WhatsApp updates. */
export const whatsappAllowed = (latestConsent: { whatsapp: boolean; withdrawnAt: Date | null } | null) => Boolean(latestConsent?.whatsapp && !latestConsent.withdrawnAt);

/** Call-back offered by default after a timing / shift reason or a hold (HR may set one on any decided candidate). */
export function callbackReason(outcome: string, categoryCode: string | null, categoryLabel: string | null): string | null {
  if (outcome === "on_hold") return "On hold";
  if (categoryCode === "notice_timing" || categoryCode === "shift_location") return categoryLabel ?? categoryCode;
  return null;
}

/** Default call-back day: decision day + notice days; no / zero notice → the default from Settings. */
export const defaultCallbackDay = (decisionDay: string, noticeDays: number | null, fallbackDays: number) => addDays(decisionDay, noticeDays && noticeDays > 0 ? noticeDays : fallbackDays);
