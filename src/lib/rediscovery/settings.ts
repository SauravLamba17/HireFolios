// Settings → Rediscovery: every threshold, template and weight of Phase 3.6 (docs/REDISCOVERY.md). Pure (browser-safe).
// These values only SEED a tenant (marked sample); the live values are the tenant_settings rows.
import { z } from "zod";

type NumSpec = { kind: "number"; default: number; min: number; max: number; step: number; label: string; help: string; group: Group };
type BoolSpec = { kind: "boolean"; default: boolean; label: string; help: string; group: Group };
type TextSpec = { kind: "text"; default: string; max: number; label: string; help: string; group: Group; multiline?: boolean };
type Spec = NumSpec | BoolSpec | TextSpec;
export type Group = "scores" | "contact" | "risk" | "bulk" | "weights" | "templates";

export const GROUPS: Record<Group, string> = {
  scores: "Scores and keep period",
  contact: "Contact and call-backs",
  risk: "Joining-risk hints",
  bulk: "Bulk hiring lists",
  weights: "How bulk lists are ranked (weights)",
  templates: "WhatsApp templates",
};

const num = (d: number, min: number, max: number, step: number, label: string, help: string, group: Group): NumSpec => ({ kind: "number", default: d, min, max, step, label, help, group });
const bool = (d: boolean, label: string, help: string): BoolSpec => ({ kind: "boolean", default: d, label, help, group: "risk" });
const tpl = (d: string, label: string): TextSpec => ({
  kind: "text",
  default: d,
  max: 1000,
  label,
  help: "Placeholders: {name} {company} {position} {hr_name}.",
  group: "templates",
  multiline: true,
});

export const SETTINGS = {
  score_threshold: num(3.5, 1, 5, 0.1, "Strong score (of 5)", "Average interview score from which a person counts as strong for suggestions and ranking. Inclusive: 3.5 counts at 3.5.", "scores"),
  talent_pool_keep_months: num(24, 1, 60, 1, "Talent pool keep period (months)", "Talent-pool candidates are kept this long after their last visit or last consent renewal, then the deletion job removes them.", "scores"),
  contact_cooling_days: num(30, 0, 365, 1, "Cooling period (days)", "Contacted fewer days ago than this: HR sees a soft warning before contacting again (never blocks).", "contact"),
  callback_default_days: num(30, 1, 365, 1, "Default call-back after (days)", "Call-back date when the candidate has no notice period. Otherwise: decision day + notice period.", "contact"),
  risk_other_offer_on: bool(true, "Other offer in hand", "Hint when another company's offer is noted."),
  risk_notice_on: bool(true, "Long notice period", "Hint when the notice period is at least the days below."),
  risk_notice_days: num(60, 0, 365, 1, "Notice period from (days)", "Used by the long notice hint.", "risk"),
  risk_ctc_on: bool(true, "Expected CTC above offer", "Hint when the expected CTC is above the offered CTC by at least the percent below."),
  risk_ctc_gap_percent: num(15, 0, 200, 1, "CTC gap from (%)", "Used by the CTC hint.", "risk"),
  risk_joining_on: bool(true, "Joining date far away", "Hint when the joining date is more than the days below away."),
  risk_joining_days: num(30, 0, 365, 1, "Joining more than (days) away", "Used by the joining date hint.", "risk"),
  risk_city_mismatch: bool(false, "Lives in another city", "Hint when the candidate's city is not the office city below (off by default)."),
  office_city: { kind: "text", default: "", max: 100, label: "Office city", help: "For the city hint. Empty: the hint stays off.", group: "risk" } satisfies TextSpec,
  bulk_recency_months: num(24, 1, 120, 1, "Look back (months)", "Bulk lists include people whose last visit is this recent.", "bulk"),
  bulk_over_budget_percent: num(10, 0, 100, 1, "Allowed over budget (%)", "Up to this much over the budget is listed lower with “+x% over budget”; more is left out (and counted).", "bulk"),
  rank_weight_budget: num(30, 0, 100, 1, "Budget fit", "Expected CTC within the budget.", "weights"),
  rank_weight_score: num(25, 0, 100, 1, "Interview score", "Average interview score.", "weights"),
  rank_weight_skills: num(20, 0, 100, 1, "Skills match", "Certifications, software and experience asked for.", "weights"),
  rank_weight_shift: num(10, 0, 100, 1, "Shift fit", "Night shift / voice process when asked for.", "weights"),
  rank_weight_improvement: num(5, 0, 100, 1, "Score improvement", "Score went up between visits.", "weights"),
  rank_weight_recency: num(10, 0, 100, 1, "Recent visit", "Visited recently.", "weights"),
  wa_bulk_en: tpl(
    "Hello {name}, this is {hr_name} from {company}. We have new openings for {position}. You visited us before and we would like to invite you again. Reply here or call us if you are interested.",
    "Bulk opening (English)",
  ),
  wa_bulk_hi: tpl(
    "नमस्ते {name}, मैं {company} से {hr_name} बोल रहा/रही हूँ। हमारे यहाँ {position} के लिए नई जगहें खुली हैं। आप पहले हमसे मिल चुके हैं, हम आपको फिर से बुलाना चाहते हैं। रुचि हो तो यहीं जवाब दें या हमें कॉल करें।",
    "Bulk opening (Hindi)",
  ),
  wa_callback_en: tpl(
    "Hello {name}, this is {hr_name} from {company}. As discussed during your visit, we are getting back to you about the {position} role. Is this a good time to talk?",
    "Call-back (English)",
  ),
  wa_callback_hi: tpl(
    "नमस्ते {name}, मैं {company} से {hr_name}। आपकी पिछली मुलाक़ात में हुई बात के अनुसार हम {position} की नौकरी के बारे में संपर्क कर रहे हैं। क्या अभी बात करना ठीक रहेगा?",
    "Call-back (Hindi)",
  ),
  wa_consent_en: tpl(
    "Hello {name}, this is {hr_name} from {company}. May we keep your details on file to contact you about future openings? You can say no or ask us to delete them at any time.",
    "Ask for consent to keep details (English)",
  ),
  wa_consent_hi: tpl(
    "नमस्ते {name}, मैं {company} से {hr_name}। क्या हम भविष्य की नौकरियों के लिए आपसे संपर्क करने हेतु आपकी जानकारी रख सकते हैं? आप कभी भी मना कर सकते हैं या जानकारी हटाने के लिए कह सकते हैं।",
    "Ask for consent to keep details (Hindi)",
  ),
} satisfies Record<string, Spec>;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
type ValueOf<S> = S extends NumSpec ? number : S extends BoolSpec ? boolean : string;
export type RediscoverySettings = { [K in SettingKey]: ValueOf<(typeof SETTINGS)[K]> };
/** Settings plus which keys still hold the seeded sample value (not yet saved by an admin). */
export type SettingsWithSample = { values: RediscoverySettings; sample: Partial<Record<SettingKey, boolean>> };

export const defaultSettings = (): RediscoverySettings =>
  Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS[k].default])) as RediscoverySettings;

/** zod schema of one setting's value (limits from SETTINGS). */
export function settingSchema(key: SettingKey) {
  const s: Spec = SETTINGS[key];
  if (s.kind === "number") {
    const base = z.number(`${s.label}: enter a number`).min(s.min, `${s.label}: ${s.min} to ${s.max}`).max(s.max, `${s.label}: ${s.min} to ${s.max}`);
    return s.step >= 1 ? base.int(`${s.label}: a whole number`) : base;
  }
  if (s.kind === "boolean") return z.boolean(`${s.label}: on or off`);
  const t = z.string(`${s.label}: enter text`).trim().max(s.max, `${s.label}: ${s.max} characters at most`);
  return s.group === "templates" ? t.min(1, `${s.label}: enter the message`) : t;
}

/** A patch from the Settings form: known keys only, each checked against its limits. */
export const SettingsPatch = z
  .record(z.string(), z.unknown())
  .transform((obj, ctx) => {
    const out: Partial<RediscoverySettings> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in SETTINGS)) {
        ctx.addIssue({ code: "custom", message: `Unknown setting: ${k}` });
        return z.NEVER;
      }
      const r = settingSchema(k as SettingKey).safeParse(v);
      if (!r.success) {
        ctx.addIssue({ code: "custom", message: r.error.issues[0].message });
        return z.NEVER;
      }
      (out as Record<string, unknown>)[k] = r.data;
    }
    if (Object.keys(out).length === 0) {
      ctx.addIssue({ code: "custom", message: "Nothing to save" });
      return z.NEVER;
    }
    return out;
  });

/** A stored value that no longer passes (e.g. limits changed): fall back to the default rather than break pages. */
export function readSetting(key: SettingKey, raw: unknown) {
  const r = settingSchema(key).safeParse(raw);
  return r.success ? r.data : SETTINGS[key].default;
}

export const rankWeights = (s: RediscoverySettings) => ({
  budget: s.rank_weight_budget,
  score: s.rank_weight_score,
  skills: s.rank_weight_skills,
  shift: s.rank_weight_shift,
  improvement: s.rank_weight_improvement,
  recency: s.rank_weight_recency,
});
