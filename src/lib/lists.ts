// Pick-lists (certifications, EHR, education, ...): what they are and their shape. Pure: used by the browser too.
// The items live per tenant in the option_items table (Settings → Lists); src/lib/options.ts only seeds them.

import { CERTIFICATIONS, CODING_SPECIALTIES, EDUCATION, EHR_SOFTWARE, LANGUAGES, NOTICE_PERIODS, SOURCES } from "@/lib/options";

export const LIST_KEYS = ["certification", "coding_specialty", "ehr_software", "education", "notice_period", "source", "language"] as const;
export type ListKey = (typeof LIST_KEYS)[number];

export const LIST_META: Record<ListKey, { title: string; help: string }> = {
  certification: { title: "Certifications", help: "Coding / billing certifications HR can tick at intake; also used for a job's required certifications." },
  coding_specialty: { title: "Coding specialties", help: "Shown for coding jobs, or once a certification is ticked." },
  ehr_software: { title: "EHR / PM software", help: "Software the candidate has used." },
  education: { title: "Education", help: "Highest qualification (one choice)." },
  notice_period: { title: "Notice periods", help: "How soon the candidate can join. Each has a number of days (fixed once added; add a new one instead)." },
  source: { title: "Sources", help: "How the candidate heard about the opening." },
  language: { title: "Languages", help: "Languages the candidate speaks." },
};

export type ListItem = { id: string; label: string; days: number | null; active: boolean; sample: boolean };
/** Every list with all its items (active and retired), in order. */
export type OptionLists = Record<ListKey, ListItem[]>;

/** Labels HR may pick on a new form (active items only). */
export const activeLabels = (lists: OptionLists, key: ListKey) => lists[key].filter((i) => i.active).map((i) => i.label);

/** Notice period label for a number of days (retired items still name old records). */
export function noticeLabelFrom(lists: OptionLists, days: number | null) {
  if (days === null) return null;
  return lists.notice_period.find((n) => n.days === days)?.label ?? (days === 0 ? "Immediate" : `${days} days`);
}

/** Starting items of every list (from src/lib/options.ts): seeds a tenant's lists and builds lists in tests. */
export function defaultListItems(): Record<ListKey, { label: string; days: number | null }[]> {
  const one = (labels: readonly string[]) => labels.map((label) => ({ label, days: null }));
  return {
    certification: one(CERTIFICATIONS),
    coding_specialty: one(CODING_SPECIALTIES),
    ehr_software: one(EHR_SOFTWARE),
    education: one(EDUCATION),
    notice_period: NOTICE_PERIODS.map((n) => ({ label: n.label, days: n.days })),
    source: one(SOURCES),
    language: one(LANGUAGES),
  };
}

/** The default lists as OptionLists (all active, marked sample), e.g. for tests. */
export function defaultOptionLists(): OptionLists {
  const d = defaultListItems();
  return Object.fromEntries(
    LIST_KEYS.map((k) => [k, d[k].map((it, i) => ({ id: `${k}-${i}`, label: it.label, days: it.days, active: true, sample: true }))]),
  ) as OptionLists;
}
