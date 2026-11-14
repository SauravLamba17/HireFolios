// Every business table carries tenant_id. Queries must always filter on it server-side.
// Money: whole rupees per year (integer). Calendar dates: IST, stored as `date`.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);

// display: read-only lobby TV login, can open /tv only.
export const roleEnum = pgEnum("staff_role", ["admin", "hr", "interviewer", "manager", "display"]);
export const outcomeEnum = pgEnum("application_outcome", [
  "in_progress",
  "selected",
  "rejected",
  "on_hold",
  "withdrawn",
  "no_show",
  "offer_declined", // selected, offered a job, said no
  "joined", // selected and joined: never purged
]);
export const offerStatusEnum = pgEnum("offer_status", ["offered", "accepted", "declined"]);
// photo: live photo. cv_page: paper CV page photographed with the webcam. cv_upload: CV file (PDF/Word/image) uploaded as is.
export const fileKindEnum = pgEnum("candidate_file_kind", ["photo", "cv_page", "cv_upload"]);
export const jobStatusEnum = pgEnum("job_status", ["open", "paused", "closed"]);
export const queueEventEnum = pgEnum("queue_event_type", [
  "queued",
  "called",
  "started",
  "completed",
  "skipped",
  "returned", // left a panel without a decision (panel away / closed); keeps the queue position
]);
export const panelStatusEnum = pgEnum("panel_status", ["available", "busy", "away", "closed"]);
export const decisionEnum = pgEnum("interview_decision", ["pass", "hold", "reject"]);

/** A scorecard criterion of a stage, rated 1–5. */
export type Criterion = { label: string; required: boolean };
export const recommendationEnum = pgEnum("scorecard_recommendation", [
  "strong_yes",
  "yes",
  "no",
  "strong_no",
]);
export const dsrKindEnum = pgEnum("dsr_kind", ["access", "correction", "erasure", "withdraw_consent", "grievance"]);
export const dsrStatusEnum = pgEnum("dsr_status", ["open", "in_progress", "completed", "rejected"]);
export const exportStatusEnum = pgEnum("export_status", ["queued", "running", "done", "failed"]);

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  photoRetentionDays: integer("photo_retention_days").notNull().default(180),
  dataRetentionDays: integer("data_retention_days").notNull().default(365),
  cooldownDays: integer("cooldown_days").notNull().default(90),
  // Set by HR in Settings; used for wait estimates only until today has real interview times.
  avgInterviewMinutes: integer("avg_interview_minutes"),
  createdAt: createdAt(),
  // Company profile (Settings → Company). `name` above is the company's display name; the product name is brand.ts.
  shortName: text("short_name"),
  officeAddress: text("office_address"),
  // Stored for the SaaS phase; the app runs on IST only for now (CLAUDE.md hard rule 7, src/lib/ist.ts).
  timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
  logoKey: text("logo_key"), // under UPLOAD_DIR, served by GET /api/company/logo
  logoType: text("logo_type"),
  logoUpdatedAt: ts("logo_updated_at"),
  // Seeded values not yet saved by an admin in Settings → Company.
  profileSample: boolean("profile_sample").notNull().default(true),
});

// Pick-lists per tenant (Settings → Lists). Values are stored on candidates as their label text; an item is never
// deleted, only deactivated, so older records keep showing what was chosen then. `days` is for notice periods.
export const optionListEnum = pgEnum("option_list", [
  "certification",
  "coding_specialty",
  "ehr_software",
  "education",
  "notice_period",
  "source",
  "language",
  "reject_category", // Phase 3.6: why we did not hire (code + kind skill / non_skill / neutral)
  "rediscovery_tag", // Phase 3.6: tags for strong people not hired (code)
]);
export const optionItems = pgTable(
  "option_items",
  {
    id: id(),
    tenantId: tenantId(),
    list: optionListEnum("list").notNull(),
    label: text("label").notNull(),
    days: integer("days"),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull(),
    sample: boolean("sample").notNull().default(false),
    createdAt: createdAt(),
    // Stable key the rules use (`cost`, `do_not_rehire`, ...); renaming the label keeps the rules working.
    code: text("code"),
    kind: text("kind"), // reject_category only: skill | non_skill | neutral
  },
  (t) => [
    uniqueIndex("option_items_tenant_list_label_uq").on(t.tenantId, t.list, t.label),
    uniqueIndex("option_items_tenant_list_code_uq").on(t.tenantId, t.list, t.code).where(sql`code is not null`),
    index("option_items_tenant_list_idx").on(t.tenantId, t.list, t.position),
  ],
);

// Privacy notice versions per tenant (Settings → Privacy notice). One active version (shown at intake), at most one
// draft; published versions are never edited again. Each consent keeps the version it was given.
export const noticeStatusEnum = pgEnum("notice_status", ["draft", "active", "retired"]);
export const privacyNotices = pgTable(
  "privacy_notices",
  {
    id: id(),
    tenantId: tenantId(),
    version: text("version").notNull(),
    status: noticeStatusEnum("status").notNull(),
    effectiveDate: date("effective_date"),
    // { en: NoticeTexts, hi: NoticeTexts } with {company} {photoDays} {dataDays} {contact} placeholders (src/lib/notice.ts)
    texts: jsonb("texts").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    sample: boolean("sample").notNull().default(false),
    createdAt: createdAt(),
    createdBy: text("created_by").references(() => users.id),
    publishedAt: ts("published_at"),
    publishedBy: text("published_by").references(() => users.id),
  },
  (t) => [
    unique("privacy_notices_tenant_version_uq").on(t.tenantId, t.version),
    uniqueIndex("privacy_notices_one_active_uq").on(t.tenantId).where(sql`status = 'active'`),
    uniqueIndex("privacy_notices_one_draft_uq").on(t.tenantId).where(sql`status = 'draft'`),
  ],
);

// ---- Auth (Better Auth). Keys must match Better Auth field names. ----

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: roleEnum("role").notNull(),
    tenantId: tenantId(),
    active: boolean("active").notNull().default(true),
    // Set when an admin creates the account or resets its password; cleared when the user changes it.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // Phase 5 (internet-facing): authenticator-app two-factor (Better Auth plugin) and lockout after wrong passwords.
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    failedSignIns: integer("failed_sign_ins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("users_tenant_idx").on(t.tenantId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

// Two-factor secrets and recovery codes (Better Auth two-factor plugin; it stores them encrypted with the auth secret).
export const twoFactors = pgTable(
  "two_factors",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
  },
  (t) => [index("two_factors_user_idx").on(t.userId), index("two_factors_secret_idx").on(t.secret)],
);

// Sign-in rate limits kept in the database (Better Auth), so they survive restarts and hold across app instances.
export const rateLimits = pgTable("rate_limits", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ---- Setup ----

export const locations = pgTable(
  "locations",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    address: text("address"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("locations_tenant_name_uq").on(t.tenantId, t.name)],
);

export const devices = pgTable(
  "devices",
  {
    id: id(),
    tenantId: tenantId(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    lastSeenAt: ts("last_seen_at"),
    createdAt: createdAt(),
  },
  (t) => [unique("devices_tenant_name_uq").on(t.tenantId, t.name)],
);

export const stages = pgTable(
  "stages",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    active: boolean("active").notNull().default(true),
    isInterview: boolean("is_interview").notNull().default(false), // an interview round with a panel
    criteria: jsonb("criteria").$type<Criterion[]>().notNull().default([]),
    sample: boolean("sample").notNull().default(false), // from the seed, not yet confirmed by an admin
    createdAt: createdAt(),
  },
  (t) => [unique("stages_tenant_name_uq").on(t.tenantId, t.name)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    tenantId: tenantId(),
    title: text("title").notNull(),
    status: jobStatusEnum("status").notNull().default("open"), // only "open" jobs are offered at intake
    active: boolean("active").notNull().default(true), // legacy, kept equal to status = 'open'
    openings: integer("openings"),
    minExperienceYears: integer("min_experience_years"),
    maxExperienceYears: integer("max_experience_years"),
    requiredCertifications: text("required_certifications").array().notNull().default(sql`'{}'::text[]`),
    sample: boolean("sample").notNull().default(false), // added by the seed, not yet confirmed by an admin
    createdAt: createdAt(),
  },
  (t) => [
    unique("jobs_tenant_title_uq").on(t.tenantId, t.title),
    check("jobs_numbers_ck", sql`coalesce(${t.openings}, 0) >= 0 and coalesce(${t.minExperienceYears}, 0) >= 0 and coalesce(${t.maxExperienceYears}, 0) >= 0`),
    check("jobs_experience_range_ck", sql`${t.minExperienceYears} is null or ${t.maxExperienceYears} is null or ${t.minExperienceYears} <= ${t.maxExperienceYears}`),
  ],
);

export const drives = pgTable(
  "drives",
  {
    id: id(),
    tenantId: tenantId(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    driveDate: date("drive_date", { mode: "string" }).notNull(),
    active: boolean("active").notNull().default(true),
    closedAt: ts("closed_at"), // "End of day"
    closedBy: text("closed_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("drives_tenant_date_idx").on(t.tenantId, t.driveDate),
    unique("drives_tenant_location_day_uq").on(t.tenantId, t.locationId, t.driveDate),
  ],
);

export const panels = pgTable(
  "panels",
  {
    id: id(),
    tenantId: tenantId(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    locationId: uuid("location_id").references(() => locations.id),
    name: text("name").notNull(), // the room; a room's row is reused on later drive days
    active: boolean("active").notNull().default(true),
    driveId: uuid("drive_id").references(() => drives.id),
    interviewerId: text("interviewer_id").references(() => users.id),
    status: panelStatusEnum("status").notNull().default("available"),
    createdAt: createdAt(),
  },
  (t) => [unique("panels_tenant_name_uq").on(t.tenantId, t.name)],
);

// Editable list shown when a round rejects a candidate (seeded from REJECT_REASONS in options.ts).
export const rejectReasons = pgTable(
  "reject_reasons",
  {
    id: id(),
    tenantId: tenantId(),
    label: text("label").notNull(),
    position: integer("position").notNull(),
    active: boolean("active").notNull().default(true),
    sample: boolean("sample").notNull().default(false),
    createdAt: createdAt(),
    categoryCode: text("category_code"), // reject_category item code (Phase 3.6)
  },
  (t) => [unique("reject_reasons_tenant_label_uq").on(t.tenantId, t.label)],
);

// ---- Candidates (no Aadhaar collected at intake) ----

export const candidates = pgTable(
  "candidates",
  {
    id: id(),
    tenantId: tenantId(),
    fullName: text("full_name").notNull(),
    mobile: text("mobile").notNull(),
    email: text("email"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    city: text("city"),
    qualification: text("qualification"),
    experienceMonths: integer("experience_months"),
    currentCtc: integer("current_ctc"), // whole rupees per year
    expectedCtc: integer("expected_ctc"), // whole rupees per year
    noticeDays: integer("notice_days"),
    languages: text("languages").array().notNull().default(sql`'{}'::text[]`),
    skills: text("skills"),
    // RCM (US healthcare revenue cycle) profile. Values come from src/lib/options.ts.
    certifications: text("certifications").array().notNull().default(sql`'{}'::text[]`),
    codingSpecialties: text("coding_specialties").array().notNull().default(sql`'{}'::text[]`),
    ehrSoftware: text("ehr_software").array().notNull().default(sql`'{}'::text[]`),
    nightShiftOk: boolean("night_shift_ok"),
    voiceProcess: boolean("voice_process"),
    typingWpm: integer("typing_wpm"), // entered by HR for now
    // Written by the app on every save (src/lib/candidate-search.ts); feeds full-text search.
    searchText: text("search_text").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("candidates_tenant_mobile_uq").on(t.tenantId, t.mobile),
    index("candidates_full_name_trgm_idx").using("gin", t.fullName.op("gin_trgm_ops")),
    index("candidates_mobile_trgm_idx").using("gin", t.mobile.op("gin_trgm_ops")), // quick-look: 4+ digits of a mobile
    index("candidates_search_fts_idx").using("gin", sql`to_tsvector('simple', ${t.searchText})`),
    check("candidates_typing_wpm_ck", sql`${t.typingWpm} is null or ${t.typingWpm} between 1 and 250`),
    check("candidates_mobile_ck", sql`${t.mobile} ~ '^[6-9][0-9]{9}$'`),
    check(
      "candidates_money_ck",
      sql`coalesce(${t.currentCtc}, 0) >= 0 and coalesce(${t.expectedCtc}, 0) >= 0`,
    ),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: id(),
    tenantId: tenantId(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    driveId: uuid("drive_id").references(() => drives.id),
    token: text("token").notNull(),
    tokenDate: date("token_date", { mode: "string" }).notNull(), // IST calendar day
    currentStageId: uuid("current_stage_id")
      .notNull()
      .references(() => stages.id),
    outcome: outcomeEnum("outcome").notNull().default("in_progress"),
    rejectReason: text("reject_reason"),
    clientRequestId: uuid("client_request_id").notNull(), // idempotency key from the browser
    panelId: uuid("panel_id").references(() => panels.id), // set while in an interview
    decidedAt: ts("decided_at"), // final outcome time (selected / rejected / no show / walked away)
    purgeAfter: ts("purge_after"), // retention: delete data after this (null = talent pool / not decided)
    photoPurgeAfter: ts("photo_purge_after"),
    // Offer and joining (after Selected). CTC in whole rupees per year, dates are IST calendar days.
    offerStatus: offerStatusEnum("offer_status"),
    offeredCtc: integer("offered_ctc"),
    joiningDate: date("joining_date", { mode: "string" }), // planned
    joinedOn: date("joined_on", { mode: "string" }), // actual
    source: text("source"), // how the candidate heard about the opening (src/lib/options.ts)
    hrNotes: text("hr_notes"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Phase 3.6: why we did not hire (reject_category code) and the figures of a cost decision (rupees per year;
    // budget = offered CTC for a declined offer). Joining-risk hint codes saved when the offer was recorded.
    rejectCategory: text("reject_category"),
    costExpectedCtc: integer("cost_expected_ctc"),
    costBudgetCtc: integer("cost_budget_ctc"),
    riskHints: text("risk_hints").array(),
  },
  (t) => [
    unique("applications_tenant_client_request_uq").on(t.tenantId, t.clientRequestId),
    unique("applications_tenant_day_token_uq").on(t.tenantId, t.tokenDate, t.token),
    index("applications_candidate_idx").on(t.candidateId),
    index("applications_tenant_drive_idx").on(t.tenantId, t.driveId),
    // One candidate per panel at a time, enforced by the database (two "Assign next" at once).
    uniqueIndex("applications_panel_uq").on(t.panelId).where(sql`${t.panelId} is not null`),
    check(
      "applications_reject_reason_ck",
      sql`${t.outcome} <> 'rejected' or ${t.rejectReason} is not null`,
    ),
  ],
);

export const candidateFiles = pgTable(
  "candidate_files",
  {
    id: id(),
    tenantId: tenantId(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id),
    kind: fileKindEnum("kind").notNull(),
    storageKey: text("storage_key").notNull().unique(), // path under /data, never public
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    pageNo: integer("page_no"),
    sha256: text("sha256"),
    createdAt: createdAt(),
    deletedAt: ts("deleted_at"), // set when purged by retention
  },
  (t) => [index("candidate_files_candidate_idx").on(t.candidateId)],
);

export const queueEvents = pgTable(
  "queue_events",
  {
    id: id(),
    tenantId: tenantId(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    panelId: uuid("panel_id").references(() => panels.id),
    event: queueEventEnum("event").notNull(),
    actorUserId: text("actor_user_id").references(() => users.id),
    interviewerId: text("interviewer_id").references(() => users.id), // panel's interviewer when called
    note: text("note"), // reason for overrides, no-shows etc. (kept out of audit_log)
    createdAt: createdAt(),
  },
  (t) => [
    index("queue_events_application_idx").on(t.applicationId),
    index("queue_events_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

export const scorecards = pgTable(
  "scorecards",
  {
    id: id(),
    tenantId: tenantId(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id),
    interviewerId: text("interviewer_id")
      .notNull()
      .references(() => users.id),
    scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
    overall: integer("overall"),
    recommendation: recommendationEnum("recommendation"),
    decision: decisionEnum("decision"),
    rejectReason: text("reject_reason"),
    panelId: uuid("panel_id").references(() => panels.id),
    comments: text("comments"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("scorecards_application_stage_interviewer_uq").on(
      t.applicationId,
      t.stageId,
      t.interviewerId,
    ),
    check("scorecards_overall_ck", sql`${t.overall} between 1 and 5`),
  ],
);

// Per-tenant, per-IST-day token counter (atomic upsert hands out the next token).
export const dailyCounters = pgTable(
  "daily_counters",
  {
    tenantId: tenantId(),
    counterDate: date("counter_date", { mode: "string" }).notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.counterDate] })],
);

export const consents = pgTable(
  "consents",
  {
    id: id(),
    tenantId: tenantId(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id),
    noticeVersion: text("notice_version").notNull(),
    // The exact notice text shown (null for consents given before notices lived in the database).
    noticeId: uuid("notice_id").references(() => privacyNotices.id),
    language: text("language").notNull().default("en"), // language the notice was shown in
    // Purposes. Assessing this application is the required one; these two are optional extras.
    talentPool: boolean("talent_pool").notNull().default(false),
    whatsapp: boolean("whatsapp").notNull().default(false),
    acceptedAt: ts("accepted_at").notNull().defaultNow(),
    deviceId: uuid("device_id").references(() => devices.id),
    recordedBy: text("recorded_by").references(() => users.id),
    withdrawnAt: ts("withdrawn_at"),
    // Consent recorded after the visit (Phase 3.6): in_person | whatsapp | phone | email. Null = given at intake.
    channel: text("channel"),
    note: text("note"),
  },
  (t) => [index("consents_candidate_idx").on(t.candidateId)],
);

// Data subject requests (DPDP: access, correction, erasure, consent withdrawal).
export const dsrRequests = pgTable(
  "dsr_requests",
  {
    id: id(),
    tenantId: tenantId(),
    candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "set null" }),
    kind: dsrKindEnum("kind").notNull(),
    status: dsrStatusEnum("status").notNull().default("open"),
    requestedAt: ts("requested_at").notNull().defaultNow(), // when it was received
    dueAt: ts("due_at"), // received + 90 days
    requesterName: text("requester_name"),
    requesterContact: text("requester_contact"),
    resolvedAt: ts("resolved_at"),
    resolution: text("resolution"),
    handledBy: text("handled_by").references(() => users.id),
    createdBy: text("created_by").references(() => users.id),
    notes: text("notes"),
  },
  (t) => [index("dsr_requests_tenant_status_idx").on(t.tenantId, t.status)],
);

// Ids only. Never names, mobiles, emails or other personal data.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: tenantId(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export const dataExports = pgTable(
  "exports",
  {
    id: id(),
    tenantId: tenantId(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>(),
    status: exportStatusEnum("status").notNull().default("queued"),
    storageKey: text("storage_key"),
    rowCount: integer("row_count"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
    expiresAt: ts("expires_at"),
  },
  (t) => [index("exports_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

// ---- Phase 3.6: candidate 360 + rediscovery (docs/REDISCOVERY.md). HR-only data. ----
// New tables cascade with their tenant and candidate (the deletion job and clean-ups remove them with the candidate);
// staff references are set null (staff are deactivated, never deleted, in normal use).
const tenantRef = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });
const candidateRef = () =>
  uuid("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" });
const staffRef = (name: string) => text(name).references(() => users.id, { onDelete: "set null" });

// Per-tenant settings (Settings → Rediscovery): key → JSON value, checked by src/lib/rediscovery/settings.ts.
export const tenantSettings = pgTable(
  "tenant_settings",
  {
    tenantId: tenantRef(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    sample: boolean("sample").notNull().default(true),
    updatedBy: staffRef("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

export const otherOffers = pgTable(
  "other_offers",
  {
    id: id(),
    tenantId: tenantRef(),
    candidateId: candidateRef(),
    company: text("company"),
    offeredCtc: integer("offered_ctc"),
    joiningDate: date("joining_date", { mode: "string" }),
    notedOn: date("noted_on", { mode: "string" }).notNull(),
    createdBy: staffRef("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("other_offers_candidate_idx").on(t.candidateId), check("other_offers_ctc_ck", sql`coalesce(${t.offeredCtc}, 0) >= 0`)],
);

export const candidateTags = pgTable(
  "candidate_tags",
  {
    id: id(),
    tenantId: tenantRef(),
    candidateId: candidateRef(),
    tagCode: text("tag_code").notNull(),
    note: text("note"),
    source: text("source").notNull(), // manual | suggestion
    addedBy: staffRef("added_by"),
    addedAt: ts("added_at").notNull().defaultNow(),
    removedAt: ts("removed_at"),
    removedBy: staffRef("removed_by"),
    removeNote: text("remove_note"),
  },
  (t) => [
    index("candidate_tags_tenant_tag_idx").on(t.tenantId, t.tagCode),
    index("candidate_tags_candidate_idx").on(t.candidateId),
    uniqueIndex("candidate_tags_one_active_uq").on(t.candidateId, t.tagCode).where(sql`removed_at is null`),
  ],
);

// A dismissed suggestion, remembered for one decision (visit + decision time): it returns only after a new decision.
export const suggestionDismissals = pgTable(
  "suggestion_dismissals",
  {
    id: id(),
    tenantId: tenantRef(),
    candidateId: candidateRef(),
    tagCode: text("tag_code").notNull(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    decidedAt: ts("decided_at").notNull(),
    note: text("note"),
    dismissedBy: staffRef("dismissed_by"),
    dismissedAt: ts("dismissed_at").notNull().defaultNow(),
  },
  (t) => [index("suggestion_dismissals_candidate_idx").on(t.candidateId)],
);

export const hiringPushes = pgTable(
  "hiring_pushes",
  {
    id: id(),
    tenantId: tenantRef(),
    name: text("name").notNull(),
    criteria: jsonb("criteria").notNull(),
    createdBy: staffRef("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("hiring_pushes_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const pushMembers = pgTable(
  "push_members",
  {
    id: id(),
    tenantId: tenantRef(),
    pushId: uuid("push_id")
      .notNull()
      .references(() => hiringPushes.id, { onDelete: "cascade" }),
    candidateId: candidateRef(),
    status: text("status").notNull().default("to_call"), // to_call | no_answer | interested | not_interested | booked | hired
    rank: integer("rank").notNull(),
    score: integer("score").notNull(),
    why: text("why").notNull(),
    updatedBy: staffRef("updated_by"),
    updatedAt: updatedAt(),
  },
  (t) => [unique("push_members_push_candidate_uq").on(t.pushId, t.candidateId), index("push_members_candidate_idx").on(t.candidateId)],
);

export const contactLog = pgTable(
  "contact_log",
  {
    id: id(),
    tenantId: tenantRef(),
    candidateId: candidateRef(),
    channel: text("channel").notNull(), // call | whatsapp | other
    purpose: text("purpose").notNull(), // callback | bulk_push | consent | other
    outcome: text("outcome"), // no_answer | interested | not_interested | call_later | wrong_number
    note: text("note"),
    pushId: uuid("push_id").references(() => hiringPushes.id, { onDelete: "set null" }),
    contactedBy: staffRef("contacted_by"),
    contactedAt: ts("contacted_at").notNull().defaultNow(),
  },
  (t) => [index("contact_log_candidate_idx").on(t.candidateId, t.contactedAt), index("contact_log_tenant_idx").on(t.tenantId, t.contactedAt)],
);

// The candidate asked not to be contacted. Active while cleared_at is null; only an admin clears it, with a note.
export const doNotContact = pgTable(
  "do_not_contact",
  {
    id: id(),
    tenantId: tenantRef(),
    candidateId: candidateRef(),
    reason: text("reason").notNull(),
    setBy: staffRef("set_by"),
    setAt: ts("set_at").notNull().defaultNow(),
    clearedAt: ts("cleared_at"),
    clearedBy: staffRef("cleared_by"),
    clearNote: text("clear_note"),
  },
  (t) => [uniqueIndex("do_not_contact_one_active_uq").on(t.candidateId).where(sql`cleared_at is null`), index("do_not_contact_tenant_idx").on(t.tenantId)],
);

export const callbacks = pgTable(
  "callbacks",
  {
    id: id(),
    tenantId: tenantRef(),
    candidateId: candidateRef(),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "set null" }),
    dueOn: date("due_on", { mode: "string" }).notNull(), // IST calendar day
    note: text("note"),
    status: text("status").notNull().default("open"), // open | done
    outcome: text("outcome"),
    createdBy: staffRef("created_by"),
    createdAt: createdAt(),
    doneBy: staffRef("done_by"),
    doneAt: ts("done_at"),
  },
  (t) => [index("callbacks_tenant_due_idx").on(t.tenantId, t.status, t.dueOn), index("callbacks_candidate_idx").on(t.candidateId)],
);
