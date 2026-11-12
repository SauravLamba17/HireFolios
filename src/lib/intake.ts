// Intake rules shared by the intake wizard (browser) and POST /api/intake (server). No server imports here.
import { z } from "zod";
import { todayIST } from "@/lib/ist";
import { activeLabels, type OptionLists } from "@/lib/lists";

export const MIN_AGE = 18;
// Upload limits come from the server's configuration (src/lib/config.ts) and are handed to the wizard as props.
export type UploadLimits = { maxCvFiles: number; maxCvPages: number; maxUploadBytes: number; maxPageBytes: number; maxPhotoBytes: number };
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** What kind of CV file HR picked (by type or, if the browser gives none, by extension). The server re-checks the bytes. */
export function cvFileKind(f: { name: string; type: string }): "pdf" | "docx" | "image" | null {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (f.type === "application/pdf" || (!f.type && ext === "pdf")) return "pdf";
  if (f.type === DOCX_MIME || ((!f.type || f.type === "application/octet-stream") && ext === "docx")) return "docx";
  if (/^image\/(jpeg|png|webp)$/.test(f.type) || (!f.type && ["jpg", "jpeg", "png", "webp"].includes(ext))) return "image";
  return null;
}

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

// List fields accept only the tenant's active items (Settings → Lists).
const pickOne = (list: string[], msg: string) => z.string(msg).refine((v) => list.includes(v), msg);
const pickMany = (list: string[], what: string) =>
  z
    .array(z.string().refine((v) => list.includes(v), `Unknown ${what}`))
    .max(Math.max(list.length, 1))
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

// Fields that do not depend on the lists (also used to correct a candidate's identity on the profile).
export const BaseDetails = z.object({
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
  experienceYears: z.int("Choose years of experience").min(0).max(45),
  experienceMonths: z.int("Choose months of experience").min(0).max(11),
  currentCtcLpa: lpa("Current CTC"),
  expectedCtcLpa: lpa("Expected CTC"),
  hrNotes: text(1000, "HR notes are too long (1000 characters max)"),
  nightShiftOk: z.boolean("Answer: OK with night / US shift?"),
  voiceProcess: z.boolean("Answer: OK with voice process (calls)?"),
  typingWpm: z.int("Typing speed must be a whole number").min(1, "Typing speed must be 1 to 250 WPM").max(250, "Typing speed must be 1 to 250 WPM").nullable(),
  skills: text(500, "Skills are too long (500 characters max)"),
  // Phase 3.6, optional ("More details"): another company's offer the candidate already has. Never required.
  otherOffer: z
    .object({
      company: text(100, "Company name is too long (100 characters max)"),
      offeredCtcLpa: lpa("Other offer CTC"),
      joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the other offer's joining date").refine(isRealDay, "Enter a real joining date").nullable(),
    })
    .nullable()
    .optional()
    .transform((o) => (o && (o.company || o.offeredCtcLpa !== null || o.joiningDate) ? o : null)),
});

/** Intake details, checked against this tenant's active list items. */
export function makeIntakeDetails(lists: OptionLists) {
  const days = lists.notice_period.filter((n) => n.active && n.days !== null).map((n) => n.days!);
  return BaseDetails.extend({
    education: pickOne(activeLabels(lists, "education"), "Choose the education"),
    noticeDays: z.int("Choose the notice period").refine((d) => days.includes(d), "Choose the notice period"),
    languages: pickMany(activeLabels(lists, "language"), "language"),
    source: pickOne(activeLabels(lists, "source"), "Choose how they heard about us"),
    certifications: pickMany(activeLabels(lists, "certification"), "certification"),
    codingSpecialties: pickMany(activeLabels(lists, "coding_specialty"), "coding specialty"),
    ehrSoftware: pickMany(activeLabels(lists, "ehr_software"), "software"),
  });
}

export const Consent = z.object({
  agreed: z.literal(true, "Candidate consent is required"),
  language: z.enum(["en", "hi"]),
  // Compared with the active notice by the server (POST /api/intake).
  noticeVersion: z.string().min(1),
  talentPool: z.boolean(),
  whatsapp: z.boolean(),
});

export const makeIntakeRequest = (lists: OptionLists) =>
  z.object({
    clientRequestId: z.uuid(),
    mobile: Mobile,
    details: makeIntakeDetails(lists),
    consent: Consent,
  });

export type IntakeDetailsInput = z.input<ReturnType<typeof makeIntakeDetails>>;
export type IntakeRequestInput = z.input<ReturnType<typeof makeIntakeRequest>>;
export type IntakeRequestData = z.output<ReturnType<typeof makeIntakeRequest>>;

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
      /** Phase 3.6: HR-only "Do not rehire" tag (reason, who, when). HR still decides; never on the consent screen. */
      doNotRehire: { reason: string | null; by: string | null; at: string } | null;
    };

/** First validation message; zod's generic ones get the field name so they can be traced. */
export function firstIssue(error: z.ZodError) {
  const i = error.issues[0];
  return i.message.startsWith("Invalid") && i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message;
}
