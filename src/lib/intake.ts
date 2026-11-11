// Intake rules shared by the intake wizard (browser) and POST /api/intake (server). No server imports here.
import { z } from "zod";
import { todayIST } from "@/lib/ist";
import { NOTICE_VERSION } from "@/lib/notice";
import { CERTIFICATIONS, CODING_SPECIALTIES, EDUCATION, EHR_SOFTWARE, LANGUAGES, NOTICE_PERIODS, SOURCES } from "@/lib/options";

export const MIN_AGE = 18;
export const MAX_CV_PAGES = 10;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // each uploaded CV file
export const MAX_CV_FILES = 5;
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** What kind of CV file HR picked (by type or, if the browser gives none, by extension). The server re-checks the bytes. */
export function cvFileKind(f: { name: string; type: string }): "pdf" | "docx" | "image" | null {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (f.type === "application/pdf" || (!f.type && ext === "pdf")) return "pdf";
  if (f.type === DOCX_MIME || ((!f.type || f.type === "application/octet-stream") && ext === "docx")) return "docx";
  if (/^image\/(jpeg|png|webp)$/.test(f.type) || (!f.type && ["jpg", "jpeg", "png", "webp"].includes(ext))) return "image";
  return null;
}
export const MAX_PAGE_BYTES = 4 * 1024 * 1024; // one photographed CV page (~1800px JPEG)
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // live photo (~800px JPEG)

/** Indian mobile → 10 digits starting 6-9, or null. Accepts +91 / 0091 / 91 / leading 0, spaces, dashes. */
export function normalizeMobile(raw: string): string | null {
  let d = raw.replace(/[\s\-().]/g, "").replace(/^(\+91|0091)/, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** Whole years between two YYYY-MM-DD calendar days. */
export function ageOn(dateOfBirth: string, day: string) {
  const years = Number(day.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return day.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** Latest date of birth that is 18 today in India (for the date picker's max). */
export function latestAdultDob(today = todayIST()) {
  return `${Number(today.slice(0, 4)) - MIN_AGE}${today.slice(4)}`;
}

const isRealDay = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

// Optional text: "" and null both mean "not given".
const text = (max: number, msg: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .nullable()
    .transform((v) => v || null);

const pickMany = <T extends readonly [string, ...string[]]>(list: T, what: string) =>
  z
    .array(z.enum(list, `Unknown ${what}`))
    .max(list.length)
    .transform((v) => [...new Set(v)]);

const lpa = (what: string) =>
  z
    .number(`Enter ${what} in LPA`)
    .min(0, `${what} can't be negative`)
    .max(100, `${what} looks too high (LPA means lakh per year)`)
    .nullable();

export const Mobile = z.string("Enter the mobile number").transform((v, ctx) => {
  const m = normalizeMobile(v);
  if (!m) ctx.addIssue({ code: "custom", message: "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9" });
  return m ?? z.NEVER;
});

export const IntakeDetails = z.object({
  jobId: z.uuid("Choose a position"),
  fullName: z.string("Enter the full name").trim().min(2, "Enter the full name").max(100, "Name is too long"),
  dateOfBirth: z
    .string("Enter the date of birth")
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth")
    .refine(isRealDay, "Enter a real date of birth")
    .refine((v) => v >= "1940-01-01" && v <= todayIST(), "Enter a real date of birth")
    .refine((v) => ageOn(v, todayIST()) >= MIN_AGE, `Candidate must be at least ${MIN_AGE} years old`),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Email is too long")
    .pipe(z.union([z.literal(""), z.email("Enter a valid email or leave it empty")]))
    .nullable()
    .transform((v) => v || null),
  city: z.string("Enter the city").trim().min(2, "Enter the city").max(100, "City is too long"),
  education: z.enum(EDUCATION, "Choose the education"),
  experienceYears: z.int("Choose years of experience").min(0).max(45),
  experienceMonths: z.int("Choose months of experience").min(0).max(11),
  currentCtcLpa: lpa("Current CTC"),
  expectedCtcLpa: lpa("Expected CTC"),
  noticeDays: z
    .int("Choose the notice period")
    .refine((d) => NOTICE_PERIODS.some((n) => n.days === d), "Choose the notice period"),
  languages: pickMany(LANGUAGES, "language"),
  source: z.enum(SOURCES, "Choose how they heard about us"),
  hrNotes: text(1000, "HR notes are too long (1000 characters max)"),
  certifications: pickMany(CERTIFICATIONS, "certification"),
  codingSpecialties: pickMany(CODING_SPECIALTIES, "coding specialty"),
  ehrSoftware: pickMany(EHR_SOFTWARE, "software"),
  nightShiftOk: z.boolean("Answer: OK with night / US shift?"),
  voiceProcess: z.boolean("Answer: OK with voice process (calls)?"),
  typingWpm: z.int("Typing speed must be a whole number").min(1, "Typing speed must be 1 to 250 WPM").max(250, "Typing speed must be 1 to 250 WPM").nullable(),
  skills: text(500, "Skills are too long (500 characters max)"),
});

export const Consent = z.object({
  agreed: z.literal(true, "Candidate consent is required"),
  language: z.enum(["en", "hi"]),
  noticeVersion: z.literal(NOTICE_VERSION, "The privacy notice changed. Show it to the candidate again."),
  talentPool: z.boolean(),
  whatsapp: z.boolean(),
});

export const IntakeRequest = z.object({
  clientRequestId: z.uuid(),
  mobile: Mobile,
  details: IntakeDetails,
  consent: Consent,
});

export type IntakeDetailsInput = z.input<typeof IntakeDetails>;
export type IntakeRequestInput = z.input<typeof IntakeRequest>;
export type IntakeRequestData = z.output<typeof IntakeRequest>;

/** What POST /api/intake returns (also for a retried request). */
export type IntakeResult = {
  token: string;
  tokenDate: string;
  applicationId: string;
  candidateId: string;
  fullName: string;
  jobTitle: string;
  returning: boolean;
  duplicates: { id: string; fullName: string; mobileLast4: string; reason: "same email" | "similar name and same date of birth" }[];
};

/** Saved details of a returning candidate, used to prefill the form (any field may be missing). */
export type Prefill = {
  fullName: string;
  dateOfBirth: string | null;
  email: string | null;
  city: string | null;
  education: string | null;
  experienceMonths: number | null;
  currentCtcLpa: number | null;
  expectedCtcLpa: number | null;
  noticeDays: number | null;
  languages: string[];
  skills: string | null;
  certifications: string[];
  codingSpecialties: string[];
  ehrSoftware: string[];
  nightShiftOk: boolean | null;
  voiceProcess: boolean | null;
  typingWpm: number | null;
  lastJobId: string | null;
};

/** GET /api/candidates/lookup response. HR only: never shown on the candidate-facing consent screen. */
export type LookupResult =
  | { found: false; mobile: string }
  | {
      found: true;
      mobile: string;
      candidateId: string;
      photoFileId: string | null;
      prefill: Prefill;
      visits: { token: string; day: string; job: string; stage: string; outcome: string; rejectReason: string | null }[];
      today: { token: string; job: string } | null;
      cooldown: { until: string; reason: string | null } | null;
    };

/** First validation message; zod's generic ones get the field name so they can be traced. */
export function firstIssue(error: z.ZodError) {
  const i = error.issues[0];
  return i.message.startsWith("Invalid") && i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message;
}
