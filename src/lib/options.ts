// Pick-lists used at intake, in search filters and in settings.
// SAMPLE LISTS for Simplen HR to confirm. Values are stored as shown, so renaming an entry
// later leaves older records with the old text (search still finds them).

export const CERTIFICATIONS = ["CPC", "COC", "CPC-P", "CCS", "CCS-P", "CPB", "CRCS", "CMRS", "Other"] as const;

export const CODING_SPECIALTIES = [
  "E/M",
  "Surgery",
  "Radiology",
  "Emergency",
  "Anesthesia",
  "Pathology",
  "Cardiology",
  "Orthopedics",
  "Home Health",
  "Risk Adjustment/HCC",
  "Inpatient",
  "Other",
] as const;

export const EHR_SOFTWARE = [
  "Epic",
  "Cerner/Oracle Health",
  "eClinicalWorks",
  "athenaOne",
  "NextGen",
  "AdvancedMD",
  "Kareo/Tebra",
  "DrChrono",
  "Practice Fusion",
  "Allscripts/Veradigm",
  "Other",
] as const;

export const EDUCATION = [
  "10th",
  "12th",
  "Diploma",
  "B.Sc (Life Sciences)",
  "B.Sc Nursing",
  "B.Pharm",
  "BPT (Physiotherapy)",
  "BDS / BHMS / BAMS",
  "B.Com",
  "BA",
  "BBA",
  "BCA",
  "B.Sc (other)",
  "B.Tech / BE",
  "M.Sc",
  "M.Pharm / Pharm.D",
  "M.Com",
  "MBA",
  "MA",
  "Other",
] as const;

export const NOTICE_PERIODS = [
  { days: 0, label: "Immediate" },
  { days: 7, label: "7 days" },
  { days: 15, label: "15 days" },
  { days: 30, label: "30 days" },
  { days: 45, label: "45 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
] as const;

export const SOURCES = [
  "Walk-in (saw the board / heard nearby)",
  "Employee referral",
  "Naukri",
  "Indeed",
  "LinkedIn",
  "Facebook / Instagram",
  "WhatsApp group",
  "Newspaper",
  "Job fair / college",
  "Consultant / agency",
  "Other",
] as const;

export const LANGUAGES = [
  "English",
  "Hindi",
  "Punjabi",
  "Bengali",
  "Marathi",
  "Gujarati",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Odia",
  "Urdu",
  "Other",
] as const;

// Starting list for Settings → Reject reasons (the live list is the reject_reasons table).
export const REJECT_REASONS = [
  "Spoken English / communication",
  "Typing speed below requirement",
  "No relevant RCM experience",
  "Required certification missing",
  "Failed assessment / test",
  "Salary expectation above budget",
  "Notice period too long",
  "Not willing to work US / night shift",
  "Did not attend the round",
  "Other",
] as const;

export const noticeLabel = (days: number | null) =>
  days === null ? null : (NOTICE_PERIODS.find((n) => n.days === days)?.label ?? `${days} days`);

// Coding specialties apply to coding jobs, or once any certification is picked.
export const isCodingJob = (title: string) => /\bcod(er|ing)\b/i.test(title);

// Sample scorecard criteria for each interview round, each rated 1–5 (editable per stage in Settings).
export const SAMPLE_CRITERIA = ["Communication", "Process knowledge", "Typing / voice", "Attitude & stability"] as const;

// "withdrawn" is shown as "Walked away" on the drive board: the candidate left before a decision.
export const OUTCOME_LABELS: Record<string, string> = {
  in_progress: "In progress",
  selected: "Selected",
  rejected: "Rejected",
  on_hold: "On hold",
  withdrawn: "Walked away",
  no_show: "No show",
};

export const DECISION_LABELS: Record<string, string> = { pass: "Pass", hold: "Hold", reject: "Reject" };

export function experienceLabel(months: number | null) {
  if (months === null) return null;
  if (months === 0) return "Fresher";
  const y = Math.floor(months / 12), m = months % 12;
  return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(" ");
}
